var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var util = require('util');
var events = require('events');
var WebSocketServer = require('ws').Server;
var config = require('./config');

function SnapshotServer(opt) {
	this._taskCount = 0;
	this._workers = [];
	this._workerConnections = [];
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
	},

	_startWsServer: function() {
		var that = this;
		this._wsServer = new WebSocketServer({port: this._opt.wsPort}, function() {
			console.log('Web-Socket Server listening on port ' + that._opt.wsPort);
		}).on('connection', function(conn) {
			conn.on('message', function(msg) {
				msg = JSON.parse(msg);
				if(that._messageHandler[msg.type]) {
					that._messageHandler[msg.type].call(that, msg, conn);
				} else {
					console.log('Web-Socket Server unknown message type: ' + msg.type);
				}
			});
			conn.on('close', function() {
				console.log('Phantomjs worker connection closed');
			});
		});
		setTimeout(function() {
			var task = {
				url: 'http://www.baidu.com'
			};
			if(!task.storagePath) {
				task.storagePath = path.join(config.storageBasePath, encodeURIComponent(task.url)) + '.png';
			}
			that._dispatchTask(task, function(task) {
			});
		}, 2000);
	},

	_startWorker: function(id) {
		var that = this;
		var out = fs.openSync('./log/phantomjs-out.log', 'a');
		var err = fs.openSync('./log/phantomjs-err.log', 'a');
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
	},

	_dispatchTask: function(task, callback) {
		var that = this;
		var workerId, conn;
		task.id = this._taskCount++;
		workerId = 0;
		conn = this._workerConnections[workerId];
		conn && conn.send(JSON.stringify({
			type: 'task',
			task: task
		}));
		var taskCallback = function(task) {
			console.log('Phantomjs worker ' + workerId + ' task ' + task.id + ' ' + task.status);
			callback(task);
		};
		this.once('task' + task.id, taskCallback);
		setTimeout(function() {
			that.removeListener('task' + task.id, taskCallback);
		}, config.timeout);
	},

	_messageHandler: {
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
			this.emit('task' + msg.task.id, msg.task);
		}
	},

	stop: function() {
		this._workers.forEach(function(worker) {
			worker.kill();
		});
		this._wsServer.close();
	}
});

function callbackWithTimeout(callback, timeout, fallback) {
	var out = false;
	setTimeout(function() {
		out = true;
	}, timeout);
	return function() {
		if(out) {
			fallback();
		} else {
			callback();
		}
	};
}

exports.SnapshotServer = SnapshotServer;
