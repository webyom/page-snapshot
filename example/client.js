var cluster = require('cluster');
var messenger = require('messenger');

if(cluster.isMaster) {
	for(var i = 0; i < 4; i++) {
		cluster.fork();
	}
} else {
	var client = messenger.createSpeaker('127.0.0.1:5432');
	setTimeout(function() {
		for(var i = 0; i < 10; i++) {
			client.request('snapshot', {
				url: 'http://www.taobao.com/#id=' + process.pid,
				format: 'png',
				delayRender: 2000,
				getSummary: true,
				userAgent: 'Mozilla/5.0 (iPhone; U; CPU like Mac OS X; en) AppleWebKit/420+ (KHTML, like Gecko) Version/3.0 Mobile/1A543 Safari/419.3',
				javascriptEnabled: true,
				loadImages: true,
				quality: 50,
				zoomFactor: 1,
				clipRect: {
					left: 0,
					top: 0,
					width: 1300,
					height: 600
				},
				viewportSize: {
					width: 1300,
					height: 600
				}
			}, function(res) {
				console.log(process.pid + ' ' + JSON.stringify(res));
			});
		}
	}, 1000);
}