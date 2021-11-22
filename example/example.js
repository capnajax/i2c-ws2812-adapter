'use strict';

import I2cWS281xDriver from '../I2cWS281xDriver.js';
import net from 'net';

const DELAY = 125;

const ws = new I2cWS281xDriver();

function start() {

	console.log("start")

	net.createServer().listen();	
	ws.setPixelCount(1)
		.then(r)
		.catch(console.log);

	console.log("started")
}

function setColor(color, next) {

	console.log(setColor, color);

	ws.setPixelColor(0, color, 'rgb')
	.then(ws.send())
	.then(() => { return new Promise((res,rej) => {
		setTimeout(res, DELAY);
	})})
	.then(next)
	.catch(reason => { console.log(reason);});
}

function r() { console.log('r') ; setColor( [32,  0,  0], g )}
function g() { console.log('g') ; setColor( [ 0, 32,  0], b )}
function b() { console.log('b') ; setColor( [ 0,  0, 32], r )}

console.log('starting');

start();





