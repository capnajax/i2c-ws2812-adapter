
const DELAY=125

var ws = new (require('../I2cWS281xDriver'))(),

	start = () => {
		require('net').createServer().listen();	
		ws.setPixelCount(1).then(r);
	},

	setColor = (rColor, gColor, bColor, next) => {
		ws.setPixelColor(0, rColor, gColor, bColor)
		.then(ws.send())
		.then(() => { return new Promise((res,rej) => {
			setTimeout(res, DELAY);
		})})
		.then(next)
		.catch(reason => { console.log(reason);});
	},

	r = () => { console.log('r') ; setColor( 32,  0,  0, g )},
	g = () => { console.log('g') ; setColor(  0, 32,  0, b )},
	b = () => { console.log('b') ; setColor(  0,  0, 32, r )};

start();





