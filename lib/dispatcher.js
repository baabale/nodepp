var ProtocolState = require('./protocol-state');
const moment = require('moment');

var nconf = require('./utilities/config').getConfig();
var logger = require('./utilities/logging').getLogger(nconf);

class Dispatcher {
  constructor(registry = 'sonic_registry') {
    this.registry = registry;
    this.registryConfig = nconf.get('app-config')[registry];
    logger.log('info', "Starting dispatcher", { registry, "config": this.registryConfig });
    this.state = new ProtocolState(registry, this.registryConfig);
  }

  startEpp() {
    var that = this;

    var registryConfig = this.registryConfig;
    //currentState = new ProtocolState(registry, registryConfig);
    var loginTransactionId = ['login', new Date().getTime(), require('crypto').randomBytes(8).toString('hex')].join('-').toUpperCase();

    // Initialise the connection stream. Upon connection, attempt
    // to login.
    var eppCommand = () => {
      setTimeout(() => {
        this.state.login({
          "login": nconf.get('epp_login'),
          "password": nconf.get('epp_password')
        },
          loginTransactionId).then(
            function (data) {
              logger.log('info', "login data", { data });
              return;
            },
            function (error) {
              logger.log('error', "Unable to log in", { error });
              throw new Error(error);
            }
          ).catch((error) => {
            logger.log('error', "Promise rejected with", error)
          });
      }, 2000);
    };
    return this.sendMessage(eppCommand)
  }

  sendMessage(eppCommand) {
    try {
      logger.log('debug', "Calling epp command.");
      return this.state.connection.initStream().then(eppCommand).catch((error) => {
        logger.log('error', "Promise rejected with", error);
      });
    } catch (e) {
      logger.log('error', "Unable to processes EPP request");
      logger.log('error', moment().utc().toString() + ": Dispatcher error: ", e);
      this.state = false;
    }
  }

  command(command, data) {
    if (!this.state.loggedIn) {
      if (command === 'logout') {
        logger.log("warn", "Killing child process.");
        process.exit(0);
      } else if (command !== 'login') {
        logger.log('error', "Attempted " + command + " while not logged in.");
        //process.send({"error": "Not logged in."});
        return;
      }
    } else if (command) {
      logger.log('debug', "Sending a " + command);
      var that = this;
      var transactionId = data.transactionId;
      if (!transactionId) {
        transactionId = [command, new Date().getTime(), require('crypto').randomBytes(8).toString('hex')].join('-').toUpperCase();
      }
      var eppCommand = () => {
        return this.state.command(command, data, transactionId);
      };
      return this.sendMessage(eppCommand);
    }
  }
}


Dispatcher.prototype.processMessage = function processMessage(m) {
  var currentState = this.state;
  var eppCommand;

  if (currentState && currentState.connection && currentState.connection.stream) {
    var command = m.command;
    var data = m.data;
    if (!currentState.loggedIn) {
      if (command === 'logout') {
        logger.warn("Killing child process.");
        process.exit(0);
      } else if (command !== 'login') {
        logger.log("error","Attempted " + command + " while not logged in.");
        process.send({ "error": "Not logged in." });
        return;
      }
    } else if (command) {
      var transactionId = data.transactionId;
      if (!transactionId) {
        transactionId = [command, new Date().getTime(), require('crypto').randomBytes(8).toString('hex')].join('-').toUpperCase();
      }
      eppCommand = function () {
        currentState.command(command, data, transactionId).then(function (responseData) {
          process.send(responseData);
        },
          function (error) {
            logger.log("error","Command returned an error state:", error);
            throw error;
          });
      };
    }
  } else { // Initialise a connection instance with registry configuration.
    var registry = m.registry;
    var registryConfig = nconf.get('registries')[registry];
    currentState = new ProtocolState(registry, registryConfig);
    var loginTransactionId = ['login', new Date().getTime(), require('crypto').randomBytes(8).toString('hex')].join('-').toUpperCase();

    // Initialise the connection stream. Upon connection, attempt
    // to login.
    eppCommand = function () {
      setTimeout(function () {
        currentState.login({
          "login": registryConfig.login,
          "password": registryConfig.password
        },
          loginTransactionId).then(
            function (data) {
              logger.log("Got login data: ", data.toString());
              process.send(currentState.loggedIn);
            },
            function (error) {
              logger.log("error","Unable to login: ", error);
              process.send(currentState.loggedIn);
            });
      },
        2000);
    };
  }
  try {
    logger.log("debug", "Calling epp command.");
    currentState.connection.initStream().then(eppCommand);
  } catch (e) {
    logger.log("error",moment().utc().toString() + ": Dispatcher error: ", e);
    process.send({
      "msg": "Unable to processes EPP request"
    });
    this.state = false;
  }
  this.state = currentState;
};


module.exports = Dispatcher;
