var forever = require('forever-monitor');

var nconf = require('./utilities/config').getConfig();
var logger = require('./utilities/logging').getLogger(nconf);
logger.log('debug',"Got environment: ", nconf.get('EPP_REGISTRIES'));

var child = new (forever.Monitor)('./lib/server.js', {
  max: 1,
  silent: true,
  pidFile: "nodepp.pid",
  logFile: "nodepp.log",
  outFile: "node-stout.log",
  errFile: "nodepp-sterr.log",
  options: ['--registries', 'registry-test3', '--registries', 'registry-test1', '--registries', 'registry-test2']

});
child.on('exit', function() {
  logger.log('debug',"the program has exited.");
});

child.start();
