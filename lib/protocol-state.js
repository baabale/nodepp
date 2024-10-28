var EppFactory = require('../lib/epp-factory.js');
var ProtocolConnection = require('./connection.js');
var parser = require('xml2json');
var moment = require('moment');

var nconf = require('./utilities/config.js').getConfig();
var logger = require('./utilities/logging.js').getLogger(nconf);

var currRegistry;

class ProtocolState {
	constructor(registry, config) {
		currRegistry = registry;
		this.epp = EppFactory.generate(registry, config);
		this.connection = new ProtocolConnection(config);
		this.state = "offline";
		this.loggedIn = false;
	}

	idle() {
		this.state = 'idle';
		this.interval = setInterval(() => {
			var now = moment();
			if (!this.last || now.diff(this.last, 'seconds') > 60) {
				logger.log('debug',"It's been 60 seconds, calling hello for " + currRegistry);
				if (this.loggedIn) {
					this.command('hello', null, 'fake').then((helloResponse) => {
						logger.log('debug',"Hello got response: ", helloResponse.toString());
					},
					(error) => {
						logger.log('error',"Hello got error: ", error);
					}).
					catch((error) => {
						logger.log('error',"Promise failed with ", error)
						process.exit(0);
					});
				} else {
					logger.log("warn","Logged out. Can't send <hello/>");
				}
			}
		},
		5000);
	}

	resultOk(result) {
		if (result.status === 'OK') {
			return true;
		}
		return false;
	}

	processResponse(eppJson) {
		var eppData = eppJson.epp;
		if (eppData) {
			if (eppData.response) {
				var eppResponse = eppData.response;
				var returnData = {
					"result": eppResponse.result,
					"data": eppResponse.resData,
					"transactionId": eppResponse.trID
				};
				if (eppResponse.hasOwnProperty('msgQ')) {
					returnData.msgQ = eppResponse.msgQ;
				}

				return returnData;
			}
			return eppData;
		}
		return eppJson;
	}

	processReturnedXML(returnedXML) {
		var response = parser.toJson(returnedXML, {
			"object": true
		});
		logger.log('debug',"XML response", {
			"response": returnedXML.toString()
		});
		var processedResponse = this.processResponse(response);
		logger.log('debug',"Processed response", processedResponse)
		return processedResponse
	}

	login(data, transactionId) {

		return this.command('login', data, transactionId).then((data) => {
			var result = data.result;

			if (result.hasOwnProperty('code') && result.code < 2000) {
				logger.log('debug',"Logged in successfully.");
				this.loggedIn = true;
			}
			return data;
		},
		(error) => {
			throw new Error(error);
		}).
		catch((error) => {
			logger.log('error',"Promise failed", error)
		});
	}

	command(command, data, transactionId) {
		if (this.interval) {
			clearInterval(this.interval);
		}

		this.state = 'command';
		logger.log('debug',"Executing " + command)
		var eppCommand = this.epp[command];
		var xml;
		try {
			if (!eppCommand) {
				throw new Error("Unknown EPP command");
			}
			xml = this.epp[command](data, transactionId);
			logger.log('debug',"Sending", xml);
		} catch(e) {
			if (this.state !== 'idle') {
				this.idle();
			}
			throw e;
		}
		// This is a promise
		return this.connection.send(xml).then((buffer) => {

			return new Promise((resolve, reject) => {

				logger.log('debug',"Received response from registry.");
				this.last = moment();
				if (command !== 'logout') {
					this.idle();
					if (command === 'login') {
						this.loggedIn = true;
					}
				} else {
					this.loggedIn = false;
					logger.log('debug',"Logged out");
					if (data.kill) {
						logger.log("warn","Logged out and killing child process.");
						reject("Logged out")
					}
				}
				let processedXml = this.processReturnedXML(buffer)
				logger.log('debug',"Processed XML", processedXml)
				resolve(processedXml)
			});
		});
	}
}

module.exports = ProtocolState;

