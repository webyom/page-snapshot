var SnapshotServer = require('./lib/snapshot-server').SnapshotServer;
var config = require('./lib/config');
var yargs = require('yargs');
var argv = yargs
	.usage('Usage: $0 --zmq-port [num] --ws-port [num] --workers [num]')
	.alias('p', 'ms-port').default('p', config.defaultArgv.msPort).describe('p', 'Messenger listening port')
	.alias('P', 'ws-port').default('P', config.defaultArgv.wsPort).describe('P', 'Web-Socket listening port')
	.alias('w', 'workers').default('w', config.defaultArgv.workers).describe('w', 'Phantomjs worker amount')
	.alias('h', 'help').boolean('h').describe('h', 'Help')
	.argv;

if(argv.h) {
	console.log(yargs.help());
	process.exit(0);
}

var server = new SnapshotServer({
	zmqPort: argv.zmqPort, 
	wsPort: argv.wsPort, 
	workers: argv.workers
});

process.on('uncaughtException', function(err) {
	server.stop();
	console.log(err);
	process.exit(1);
});