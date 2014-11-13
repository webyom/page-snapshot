var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var util = require('util');
var events = require('events');
var messenger = require('messenger');
var WebSocketServer = require('ws').Server;
var config = require('./config');

function log(str) {
	console.log('[' + new Date().toString() + '][server]' + str);
}

function SnapshotServer() {
	this._taskCount = 0;
	this._workers = [];
	this._workerConnections = [];
	this._workerIdle = {};
	this._wsServer = null;
	this._start();
}

util.inherits(SnapshotServer, events.EventEmitter);

SnapshotServer.prototype = _.extend(SnapshotServer.prototype, {
	_start: function() {
		this._startWsServer();
		for(var i = 0; i < config.workers; i++) {
			this._startWorker(i);
		}
		this._startMsServer();
	},

	_startMsServer: function() {
		var that = this;
		var msServer = this._msServer = messenger.createListener(config.msPort);
		msServer.on('snapshot', function(client, task) {
			log('Messenger Server received snapshot request');
			that._dispatchTask('snapshot', task, function(res) {
				client.reply({
					status: res.status,
					data: res.data || {}
				});
			});
		});
		msServer.on('validate', function(client, task) {
			log('Messenger Server received validate request');
			that._dispatchTask('validate', task, function(res) {
				client.reply({
					status: res.status
				});
			});
		});
	},

	_startWsServer: function() {
		var that = this;
		this._wsServer = new WebSocketServer({port: config.wsPort}, function() {
			log('Web-Socket Server listening on port ' + config.wsPort);
		}).on('connection', function(conn) {
			conn.on('message', function(msg) {
				msg = JSON.parse(msg);
				if(that._wsMessageHandler[msg.type]) {
					that._wsMessageHandler[msg.type].call(that, msg, conn);
				} else {
					log('Web-Socket Server unknown message type: ' + msg.type);
				}
			});
			conn.on('close', function() {
				log('Phantomjs worker connection closed');
			});
		});
	},

	_startWorker: function(id) {
		var that = this;
		var worker = require('child_process').spawn(config.slimerjs ? 'slimerjs' : 'phantomjs', ['--ignore-ssl-errors=yes', __dirname + '/phantomjs-worker.js', config.wsPort, id], {stdio: ['ignore', process.stdout, process.stderr]});
		worker.on('close', function(code) {
			log('Phantomjs worker ' + id + ' exited. code is ' + code);
			that._startWorker(id);
		});
		if(this._workers[id]) {
			this._workers.splice(id, 1, worker);
			log('Phantomjs worker ' + id + ' restarted');
		} else {
			this._workers[id] = worker;
			log('Phantomjs worker ' + id + ' started');
		}
		this._workerIdle[id] = true;
	},

	_dispatchTask: function(type, task, callback) {
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
			workerId = this._taskCount % this._workerConnections.length;
		}
		this._workerIdle[workerId] = false;
		conn = this._workerConnections[workerId];
		conn && conn.send(JSON.stringify({
			type: type,
			task: task
		}));
		log('Web-Socket Server dispatched task ' + task.id + ' to Phantomjs worker ' + workerId);
		var taskCallback = function(msg) {
			called = true;
			log('Phantomjs worker ' + msg.workerId + ' task ' + msg.task.id + ' ' + msg.task.status);
			callback(msg.task);
		};
		var called = false;
		this.once('result' + task.id, taskCallback);
		setTimeout(function() {
			if(!called) {
				that.removeListener('result' + task.id, taskCallback);
				taskCallback({
					workerId: workerId, 
					task: {
						id: task.id,
						status: 'timeout'
					}
				});
			}
		}, config.timeout);
	},

	_wsMessageHandler: {
		connected: function(msg, conn) {
			var id = msg.workerId;
			if(this._workerConnections[id]) {
				this._workerConnections.splice(id, 1, conn);
				log('Phantomjs worker ' + id + ' reconnected');
			} else {
				this._workerConnections[id] = conn;
				log('Phantomjs worker ' + id + ' connected');
			}
		},

		result: function(msg, conn) {
			// worker will report its idle status by the way
			this._workerIdle[msg.workerId] = !!msg.idle;
			this.emit('result' + msg.task.id, msg);
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
