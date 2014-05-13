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
		outLine(msg.task.storagePath);
		doTask(msg.task);
	}
};

/*** task utils ***/

function doTask(task) {
	var page = webpage.create();
	task.viewportSize && (page.viewportSize = task.viewportSize);
	task.clipRect && (page.clipRect = task.clipRect);
	task.zoomFactor && (page.zoomFactor = task.zoomFactor);
	page.settings = {
		javascriptEnabled: task.javascriptEnabled !== false,
		loadImages: true,
		userAgent: 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.31 (KHTML, like Gecko) PhantomJS/1.9.0'
	};
	page.open(task.url, function (status) {
		var data
		, fetchObj;
		if(status === 'fail') {
			page.close();
		} else {
			page.evaluate(function() {
				document.body.bgColor = 'white';
			}); 
			setTimeout(function () {
				page.render(task.storagePath, {quality: task.quality});
				page.close();
				sendMessage('task', {task: {
					id: task.id,
					status: status
				}});
			}, 2000);
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
