var _ = require('lodash');
var yargs = require('yargs');

var argv;

var config = {
	init: function() {
		var env = process.env.NODE_ENV || 'development';
		var conf = require('./conf');
		var defaultArgv = _.extend(conf.default, conf[env]);
		argv = yargs
			.usage('Usage: $0 --ms-port [num] --ws-port [num] --workers [num] --slimerjs [bool]')
			.alias('p', 'ms-port').default('p', defaultArgv.msPort).describe('p', 'Messenger listening port')
			.alias('P', 'ws-port').default('P', defaultArgv.wsPort).describe('P', 'Web-Socket listening port')
			.alias('w', 'workers').default('w', defaultArgv.workers).describe('w', 'Phantomjs worker amount')
			.alias('s', 'slimerjs').default('s', defaultArgv.slimerjs).describe('s', 'Use Slimerjs')
			.alias('h', 'help').boolean('h').describe('h', 'Help')
			.argv;
		_.extend(config, defaultArgv, argv);
		config.init = function() {};
		return config;
	},

	getArgv: function() {
		this.init();
		return argv;
	},

	argHelp: function() {
		return yargs.help();
	}
};

config.init();

module.exports = config;