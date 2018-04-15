
var ws = new (require('../I2cWS281xDriver'))(),

	start = () => {
		require('net').createServer().listen();	
		ws.setPixelCount(1).then(r1);
	}

	setColor = (rColor, gColor, bColor, delay, next) => {
		ws.setPixelColor(0, rColor, gColor, bColor)
		.then(ws.send())
		.then(() => { return new Promise((res,rej) => {
			setTimeout(res, delay);
		})})
		.then(next)
		.catch(reason => { console.log(reason);});
	}

	r = () => { console.log('r') ; setColor( 32,  0,  0, 500, g )};
	g = () => { console.log('g') ; setColor(  0, 32,  0, 500, b )};
	b = () => { console.log('b') ; setColor(  0,  0, 32, 500, r )};

start();




