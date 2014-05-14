var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var util = require('util');
var events = require('events');
var zmq = require('zmq');
var messenger = require('messenger');
var WebSocketServer = require('ws').Server;
var config = require('./config');

function SnapshotServer(opt) {
	this._taskCount = 0;
	this._workers = [];
	this._workerConnections = [];
	this._workerIdle = {};
	this._wsServer = null;
	this._opt = _.extend({}, config.defaultArgv, opt);
	this._start();
}

util.inherits(SnapshotServer, events.EventEmitter);

SnapshotServer.prototype = _.extend(SnapshotServer.prototype, {
	_start: function() {
		this._startWsServer();
		for(var i = 0; i < this._opt.workers; i++) {
			this._startWorker(i);
		}
		this._startMsServer();
	},

	_startMsServer: function() {
		var that = this;
		var msServer = this._msServer = messenger.createListener(this._opt.msPort);
		msServer.on('snapshot', function(client, task) {
			console.log('Messenger Server received snapshot request');
			that._dispatchTask(task, function(res) {
				client.reply({
					status: res.status,
					data: res.data || {}
				});
			});
		});
	},

	_startWsServer: function() {
		var that = this;
		this._wsServer = new WebSocketServer({port: this._opt.wsPort}, function() {
			console.log('Web-Socket Server listening on port ' + that._opt.wsPort);
		}).on('connection', function(conn) {
			conn.on('message', function(msg) {
				msg = JSON.parse(msg);
				if(that._wsMessageHandler[msg.type]) {
					that._wsMessageHandler[msg.type].call(that, msg, conn);
				} else {
					console.log('Web-Socket Server unknown message type: ' + msg.type);
				}
			});
			conn.on('close', function() {
				console.log('Phantomjs worker connection closed');
			});
		});
	},

	_startWorker: function(id) {
		var that = this;
		var cwd = process.cwd();
		var out = fs.openSync(path.join(cwd, 'phantomjs-out.log'), 'a');
		var err = fs.openSync(path.join(cwd, 'phantomjs-err.log'), 'a');
		var worker = require('child_process').spawn('phantomjs', [__dirname + '/phantomjs-worker.js', this._opt.wsPort, id], {stdio: ['ignore', out, err]});
		worker.on('close', function(code) {
			console.log('Phantomjs worker ' + id + ' exited. code is ' + code);
			that._startWorker(id);
		});
		if(this._workers[id]) {
			this._workers.splice(id, 1, worker);
			console.log('Phantomjs worker ' + id + ' restarted');
		} else {
			this._workers[id] = worker;
			console.log('Phantomjs worker ' + id + ' started');
		}
		this._workerIdle[id] = true;
	},

	_dispatchTask: function(task, callback) {
		// the callback will be surely called
		var that = this;
		var workerId, conn;
		task.id = this._taskCount++;
		// select a idel worker
		for(var i = 0; i < this._workerConnections.length; i++) {
			if(this._workerIdle[i]) {
				workerId = i;
			}
		}
		// if no idle worker, select one randomly
		if(!(workerId >= 0)) {
			workerId = Math.floor(this._workerConnections.length * Math.random());
		}
		this._workerIdle[workerId] = false;
		conn = this._workerConnections[workerId];
		conn && conn.send(JSON.stringify({
			type: 'task',
			task: task
		}));
		console.log('Web-Socket Server dispatched task ' + task.id + ' to Phantomjs worker ' + workerId);
		var taskCallback = function(msg) {
			called = true;
			console.log('Phantomjs worker ' + msg.workerId + ' task ' + msg.task.id + ' ' + msg.task.status);
			callback(msg.task);
		};
		var called = false;
		this.once('task' + task.id, taskCallback);
		setTimeout(function() {
			if(!called) {
				that.removeListener('task' + task.id, taskCallback);
				taskCallback({msg: 'task', workerId: workerId, task: {
					id: task.id,
					status: 'timeout'
				}});
			}
		}, config.timeout);
	},

	_wsMessageHandler: {
		connected: function(msg, conn) {
			var id = msg.workerId;
			if(this._workerConnections[id]) {
				this._workerConnections.splice(id, 1, conn);
				console.log('Phantomjs worker ' + id + ' reconnected');
			} else {
				this._workerConnections[id] = conn;
				console.log('Phantomjs worker ' + id + ' connected');
			}
		},

		task: function(msg, conn) {
			// worker will report its idle status by the way
			this._workerIdle[msg.workerId] = !!msg.idle;
			this.emit('task' + msg.task.id, msg);
		}
	},

	stop: function() {
		this._workers.forEach(function(worker) {
			worker.kill();
		});
		this._wsServer.close();
	}
});

exports.SnapshotServer = SnapshotServer;
