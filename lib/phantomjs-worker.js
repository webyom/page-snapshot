var fs = require('fs');
var system = require('system');
var stdout = system.stdout;
var stderr = system.stderr;
var args = system.args;
var webpage = require('webpage');
var conf = require('./conf');

var env = system.env.NODE_ENV || 'development';
var config = extend({}, conf.default, conf[env]);
var exitCode = config.workerExitCode;
var wsPort = parseInt(args[1]);
var workerId = parseInt(args[2]);
var wsConn;
var taskQueue = [];
var taskDoing = [];
var lastIdleTime = new Date();
var storageBasePath = config.storageBasePath;

var DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.31 (KHTML, like Gecko) PhantomJS/1.9.0';

if(env == 'development') {
	storageBasePath = fs.workingDirectory + '/storage';
}

if(isNaN(wsPort) || isNaN(workerId)) {
	phantom.exit(exitCode.invalidArgs);
}
connectServer();

function connectServer() {
	wsConn = new WebSocket('ws://127.0.0.1:' + wsPort);
	wsConn.onopen = function() {
		sendMessage('connected');
	};
	wsConn.onmessage = function(msg) {
		msg = JSON.parse(msg.data);
		workerOutLine('message received: ' + msg.type + ' task ' + msg.task.id);
		dispatchTask(msg);
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

/*** task handlers ***/

function dispatchTask(msg) {
	var type = msg.type;
	var task = msg.task;
	var handler = taskHandler[type];
	task._t = new Date().getTime();
	if(handler) {
		if(taskDoing.length >= config.maxConcurrentWorkerTasks) {
			taskQueue.push({
				type: type,
				task: task
			});
		} else {
			handler(task);
		}
	} else {
		workerOutLine('unknown message type: ' + type);
	}
}

function onTaskDone(msg) {
	var idle = false;
	for(var i = 0; i < taskDoing.length; i++) {
		if(taskDoing[i].id == msg.task.id) {
			taskDoing.splice(i, 1);
			break;
		}
	}
	var item = taskQueue.shift();
	while(item && new Date().getTime() - item.task._t >= config.timeout) {
		item = taskQueue.shift();
	}
	if(!taskQueue.length) {
		idle = true;
	}
	msg.idle = idle;
	sendMessage('result', msg);
	if(item) {
		taskHandler[item.type](item.task);
	}
}

var taskHandler = {
	snapshot: function(task) {
		taskDoing.push(task);
		var path = getStoragePath(task);
		var page = webpage.create();
		var quality = -1;
		if(task.quality >= 0) {
			quality = +task.quality;
		}
		if(!config.slimerjs) {
			task.viewportSize && (page.viewportSize = task.viewportSize);
			task.clipRect && (page.clipRect = task.clipRect);
			task.zoomFactor && (page.zoomFactor = task.zoomFactor);
		}
		page.settings = {
			javascriptEnabled: task.javascriptEnabled !== false,
			loadImages: task.loadImages !== false,
			userAgent: task.userAgent || DEFAULT_USER_AGENT
		};
		page.customHeaders = {
			'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT'
		};
		if(task.cookies) {
			task.cookies.forEach(function(cookie) {
				cookie.path = cookie.path || '/';
				phantom.addCookie(cookie);
			});
		}
		page.open(task.url, function (status) {
			if(!page) {
				return;
			}
			var requestList = [];
			var delayRender = task.delayRender >= 0 ? task.delayRender : 1000;
			var toRef;
			if(status === 'fail') {
				page.close();
				page = null;
				onTaskDone({
					task: {
						id: task.id,
						status: status
					}
				});
			} else {
				page.onResourceRequested = function(data) {
					if(!(requestList.indexOf(data.url) >= 0)) {
						requestList.push(data.url);
					}
				};
				page.onResourceReceived = function(data) {
					if(data.stage != 'end') {
						return;
					}
					for(var i = 0; i < requestList.length; i++) {
						if(data.url == requestList[i]) {
							requestList.splice(i, 1);
							break;
						}
					}
					clearTimeout(toRef);
					toRef = setTimeout(function() {
						if(!requestList.length) {
							shot('A');
						}
					}, 1000);
				};
				if(config.slimerjs) {
					if(task.viewportSize) {
						page.viewportSize.width = parseInt(task.viewportSize.width) > 0 ? parseInt(task.viewportSize.width) : page.viewportSize.width;
						page.viewportSize.height = parseInt(task.viewportSize.height) > 0 ? parseInt(task.viewportSize.height) : page.viewportSize.height;
					}
					if(task.clipRect) {
						page.clipRect.width = parseInt(task.clipRect.width) > 0 ? parseInt(task.clipRect.width) : page.clipRect.width;
						page.clipRect.height = parseInt(task.clipRect.height) > 0 ? parseInt(task.clipRect.height) : page.clipRect.height;
						page.clipRect.top = parseInt(task.clipRect.top) >= 0 ? parseInt(task.clipRect.top) : page.clipRect.top;
						page.clipRect.left = parseInt(task.clipRect.left) >= 0 ? parseInt(task.clipRect.left) : page.clipRect.left;
					}
					if(parseFloat(task.zoomFactor) > 0) {
						page.zoomFactor = parseFloat(task.zoomFactor);
					}
				}
				page.evaluate(function() {
					document.body.bgColor = 'white';
				}); 
				setTimeout(function() {
					if(!requestList.length) {
						shot('B');
					}
				}, delayRender);
				setTimeout(function() {
					shot('C');
				}, config.timeout + task._t - new Date().getTime());
			}
			function shot(t) {
				if(!page) {
					return;
				}
				var summary;
				if(task.getSummary) {
					summary = getSummary(page.content);
				}
				page.render(path.full, {quality: quality});
				page.close();
				page = null;
				workerOutLine('saved snapshot into ' + path.full);
				workerOutLine('[' + t + ']snapshot task ' + task.id + ' done');
				onTaskDone({
					task: {
						id: task.id,
						status: status,
						data: {
							path: path.relative,
							summary: summary
						}
					}
				});
			};
		});
		setTimeout(function() {
			if(!page) {
				return;
			}
			page.close();
			page = null;
			onTaskDone({
				task: {
					id: task.id,
					status: 'timeout'
				}
			});
		}, config.timeout + task._t - new Date().getTime());
	},

	validate: function(task) {
		taskDoing.push(task);
		var page = webpage.create();
		page.settings = {
			javascriptEnabled: false,
			loadImages: false,
			userAgent: DEFAULT_USER_AGENT
		};
		page.customHeaders = {
			'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT'
		};
		page.open(task.url, function (status) {
			if(!page) {
				return;
			}
			page.close();
			page = null;
			workerOutLine('validate task ' + task.id + ' done');
			onTaskDone({
				task: {
					id: task.id,
					status: status
				}
			});
		});
		setTimeout(function() {
			if(!page) {
				return;
			}
			page.close();
			page = null;
			onTaskDone({
				task: {
					id: task.id,
					status: 'timeout'
				}
			});
		}, config.timeout + task._t - new Date().getTime());
	}
};

/*** task utils ***/

function getStoragePath(task) {
	var storagePath = task.storagePath;
	if(!storagePath) {
		storagePath = encodeURIComponent(task.url).replace(/%/g, '');
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

/*** utils ***/

function extend() {
	var args = Array.prototype.slice.call(arguments);
	var res = args.shift() || {};
	var ext;
	while(args.length) {
		ext = args.shift() || {};
		for(var p in ext) {
			if(Object.prototype.hasOwnProperty.call(ext, p)) {
				res[p] = ext[p];
			}
		}
	}
	return res;
}

function sendMessage(type, data) {
	data = data || {};
	data.type = type;
	data.workerId = workerId;
	wsConn && wsConn.send(JSON.stringify(data));
}

function workerOutLine(str) {
	outLine('[' + new Date().toString() + '][worker][' + workerId + ']' + str);
}

function workerErrLine(str) {
	errLine('[' + new Date().toString() + '][worker][' + workerId + ']' + str);
}

function outLine(str) {
	stdout.writeLine(str);
}

function errLine(str) {
	[stderr || stdout].writeLine(str);
}
