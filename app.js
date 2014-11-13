var SnapshotServer = require('./lib/snapshot-server').SnapshotServer;
var config = require('./lib/config');
var yargs = require('yargs');

var argv = config.getArgv();
if(argv.h) {
	console.log(config.argHelp());
	process.exit(0);
}

var server = new SnapshotServer();

process.on('uncaughtException', function(err) {
	server.stop();
	console.log(err.stack || err.message || err.err || err.toString());
	process.exit(1);
});