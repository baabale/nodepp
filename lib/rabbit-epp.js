var moment = require('moment');
var Dispatcher = require('./dispatcher');
var nconf = require('./utilities/config').getConfig();
var logger = require('./utilities/logging').getLogger(nconf);
let fs = require('fs')
// Used for error reporting.
var processId = process.pid;

var registry = nconf.get('registries')[0];
var sentry_dsn_file = nconf.get("SENTRY_DSN_FILE");
if (sentry_dsn_file) {
    let release = nconf.get("RELEASE_VERSION")
    let environment = nconf.get("SENTRY_ENVIRONMENT")
    logger.log('debug',"Parsing sentry dsn file: ", sentry_dsn_file);
    let sentryDsn = fs.readFileSync(sentry_dsn_file, 'utf8')
      var Raven = require('raven');
      Raven.config(sentryDsn.trim(), {
          release,
          environment,
          extra: {
              registry: registry
          }
      }).install();
    logger.log('info',"Initialising nodepp", {registry, environment, release});
    logger.log('debug',"environment: ", environment);
} else {
    logger.log("warn","Raven not configured.");
}
logger.log('debug',"Environment: ", process.env);
let rabbitmqUser = nconf.get('RABBITMQ_DEFAULT_USER_FILE');
let rabbitmqPass = nconf.get('RABBITMQ_DEFAULT_PASS_FILE');
var login = fs.readFileSync(rabbitmqUser, 'utf8').trim()
var password = fs.readFileSync(rabbitmqPass, 'utf8').trim()
let host = nconf.get("rabbithost") || nconf.get("RABBITMQ_HOST");
let port = nconf.get("rabbitport") || nconf.get("RABBIT_PORT");
let vhost = nconf.get("vhost") || nconf.get("RABBITMQ_DEFAULT_VHOST");
let rabbitConfig = {
  connection: {host, port, vhost, login, password},
  logLevel: nconf.get('loglevel'),
  waitForConnection: true,
  rpc: {
    timeout: 2000
  }
};
let dispatcher = new Dispatcher(registry);
dispatcher.startEpp();

logger.log('debug',"Connecting to AMQP server", rabbitConfig);
var amqpConnection = require('amqp-as-promised')(rabbitConfig);
amqpConnection.errorHandler = (error) => {
  logger.log('error',"In errorHandler", error);
  process.exit(0);
};
amqpConnection.serve('epp', registry, (incoming, headers, del) => {
    var msg = JSON.parse(String.fromCharCode.apply(String, incoming.data))
    let {command, data} = msg;
    var a = moment();
    try {
        return dispatcher.command(command, data).then((response) => {
            var b = moment();
            var diff = b.diff(a, 'milliseconds');
            var elapsed = diff.toString();
            if (command !== 'hello') {
                logger.log('info',command + " completed", {command, elapsed});
            }
            return response;
        }, (error) => {
            logger.log('error',"In error callback of promise", error);
            return error;
        });
    } catch (e) {
        logger.log('error',e);
        process.exit(1)
    }
});
process.on('SIGINT', () => {
  var logoutResponse = (data) => {
    logger.log('debug',"Got reply from logout ", data);
  };
  var data = {
    kill: true
  };

  dispatcher.command('logout', data).then((response) => {
    logger.log('debug',"Logged out");
    return response;
  }, (error) => {
    logger.log('error',error);
    return error;
  });
  amqpConnection.shutdown();
  process.exit(0);
});

