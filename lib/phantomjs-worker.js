var fs = require('fs');
var system = require('system');
var stdout = system.stdout;
var stderr = system.stderr;
var args = system.args;
var webpage = require('webpage');
var config = require('./config');
var exitCode = config.workerExitCode;

var wsPort = parseInt(args[1]);
var workerId = parseInt(args[2]);
var wsConn;
var taskQueue = [];
var taskDoing = [];
var lastIdleTime = new Date();
var storageBasePath = config.storageBasePath;
var env = system.env.NODE_ENV || 'development';

if(env == 'development') {
	storageBasePath = fs.workingDirectory + '/storage';
}

if(isNaN(wsPort) || isNaN(workerId)) {
	phantom.exit(exitCode.invalidArgs);
}
connectServer();

function connectServer() {
	wsConn = new WebSocket('ws://localhost:' + wsPort);
	wsConn.onopen = function() {
		sendMessage('connected');
	};
	wsConn.onmessage = function(msg) {
		msg = JSON.parse(msg.data);
		workerOutLine('message received: ' + msg.type);
		var handler = messageHandler[msg.type];
		if(handler) {
			handler(msg);
		} else {
			workerOutLine('unknown message type: ' + msg.type);
		}
	};
	wsConn.onerror = function(evt) {
		workerErrLine('web socket error: ' + evt.toString());
	};
	wsConn.onclose = function() {
		workerOutLine('connection closed');
		connectServer();
	};
	workerOutLine('connected to server');
}

/*** message handlers ***/

var messageHandler = {
	task: function(msg) {
		var task = msg.task;
		if(taskDoing.length >= config.maxConcurrentWorkerTasks) {
			taskQueue.push({
				t: new Date(),
				task: task
			});
		} else {
			doTask(task);
		}
	}
};

/*** task utils ***/

function onTaskDone(msg) {
	var idle = false;
	for(var i = 0; i < taskDoing.length; i++) {
		if(taskDoing[i].id == msg.task.id) {
			taskDoing.splice(i, 1);
			break;
		}
	}
	var item = taskQueue.shift();
	while(item && new Date() - item.t >= config.timeout) {
		item = taskQueue.shift();
	}
	if(!taskQueue.length) {
		idle = true;
	}
	msg.idle = idle;
	sendMessage('task', msg);
	if(item) {
		doTask(item.task);
	}
}

function getStoragePath(task) {
	var storagePath = task.storagePath;
	if(!storagePath) {
		storagePath = encodeURIComponent(task.url);
	}
	if(!(/\.(jpg|jpeg|gif|png|pdf)$/i).test(storagePath)) {
		if((/^\.?(jpg|jpeg|gif|png|pdf)$/i).test(task.format)) {
			storagePath = storagePath + '.' + task.format.replace(/^\./, '');
		} else {
			storagePath = storagePath + '.jpg';
		}
	}
	return {
		full: (storageBasePath + '/' + storagePath).replace(/\/+/g, '/'),
		relative: storagePath.replace(/^\/+/, '')
	};
}

function getSummary(content) {
	var summary = {
		title: '',
		content: ''
	};
	if(content) {
		var m = content.match(/<title>(.*?)<\/title>/i);
		if(m) {
			summary.title = m[1];
		}
		m = content.match(/<meta\b(?:[^>]*?)\bname=(["'])description\1(?:[^>]*?)\bcontent=(["'])(.*?)\2/i);
		if(m) {
			summary.content = m[3];
		}
	}
	return summary;
}

function doTask(task) {
	taskDoing.push(task);
	var path = getStoragePath(task);
	var page = webpage.create();
	var quality = 0;
	if(task.quality > 0) {
		quality = +task.quality;
	}
	task.viewportSize && (page.viewportSize = task.viewportSize);
	task.clipRect && (page.clipRect = task.clipRect);
	task.zoomFactor && (page.zoomFactor = task.zoomFactor);
	page.settings = {
		javascriptEnabled: task.javascriptEnabled !== false,
		loadImages: task.loadImages !== false,
		userAgent: task.userAgent || 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.31 (KHTML, like Gecko) PhantomJS/1.9.0'
	};
	page.open(task.url, function (status) {
		if(status === 'fail') {
			page.close();
			onTaskDone({task: {
				id: task.id,
				status: status
			}});
		} else {
			page.evaluate(function() {
				document.body.bgColor = 'white';
			}); 
			setTimeout(function () {
				var summary;
				if(task.getSummary) {
					summary = getSummary(page.content);
				}
				page.render(path.full, {quality: quality});
				page.close();
				onTaskDone({task: {
					id: task.id,
					status: status,
					data: {
						path: path.relative,
						summary: summary
					}
				}});
			}, task.delayRender >= 0 ? task.delayRender : 500);
		}
	});
}

/*** utils ***/

function sendMessage(type, data) {
	data = data || {};
	data.type = type;
	data.workerId = workerId;
	wsConn && wsConn.send(JSON.stringify(data));
}

function workerOutLine(str) {
	outLine('Worker ' + workerId + ' ' + str);
}

function workerErrLine(str) {
	errLine('Worker ' + workerId + ' ' + str);
}

function outLine(str) {
	stdout.write(str + '\n');
}

function errLine(str) {
	stderr.write(str + '\n');
}
