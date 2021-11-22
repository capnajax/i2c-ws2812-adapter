'use strict';

import { expect } from 'chai';
import fs from 'fs';
import { it } from 'mocha';
import I2cWS281xDriver from '../I2cWS281xDriver.js';

let ws;

describe('prerequisites', function() {

	var found_i2c = false;

	it('Test Machine should have an i2c device', (done) => {
		fs.readFile('/proc/modules', 'utf8', (err, data) => {
			if (err) {
				console.log("WARNING: This test reads /proc/modules to determine if ");
				console.log("       : there is an i2c device attached. ");
				done(err);
				return;
			} else {
				var lines = data.split('\n'),
					i;

				for (i = 0; i < lines.length; i++) {
					if (lines[i].startsWith('i2c_')) {
						found_i2c=true;
						done();
						return;
					}
				}
				done("Could not find an i2c device on machine");
				return;
			}
		});
	});

	after(next => {
		if (found_i2c) {
			// assumes pin 6
			ws = new I2cWS281xDriver();
		}
		next();
	});
})

describe('basic-comms', function() {

	it('should start device', function(done) {
		ws.open()
			.then(done)
			.catch(reason => { done({reason});});
	});
	it('should ack a syn', function(done) {
		ws.syn()
			.then(done)
			.catch(reason => { done({reason});});
	});
	it('should reject a bad command', function(done) {
		ws.rawCmd(0x09)
			.then(() => {
				done('Failed to fail on bad command');
			})
			.catch(reason => { 
				if (reason.err == 'BAD_COMMAND') {
					done();
				} else {
					done({reason, message: 'failed with wrong failure message'});
				}
			});
	});
	it('should set a pixel count', function(done) {
		let events = ['starting'];
		Promise.resolve()
			.then(() => {
				events.push('setting pixel ct to 0x10');
				let p = ws.setPixelCount(0x10);
				events.push('set pixel ct to 0x10');
				return p;
			})
			.then(() => {
				events.push('setting pixel ct to 0x80');
				let p = ws.setPixelCount(0x80);
				events.push('set pixel ct to 0x80');
				return p;
			})
			.then(() => {
				events.push('done');
				done();
			})
			.catch(reason => {
				done({reason, events});
			});
	});
	it('should fail to set a pixel count if it\'s too high', function(done) {
		Promise.resolve()
			.then(() => {
				return ws.setPixelCount(0xe0);
			})
			.then(() => {
				done('Failed to fail on pixel count out of range');
			})
			.catch(reason => {
				if (reason.err == 'OUT_OF_RANGE') {
					done();
				} else {
					done({reason, message: 'failed with wrong failure message'});
				}
			});
	});
	it('should set a single pixel to a colour', function(done) {
		Promise.resolve()
			.then(() => {
				return ws.setPixelCount(0x10);
			})
			.then(() => {
				return ws.setPixelColor(0, {r:0x10,g:0x01,b:0x01});
			})
			.then(() => {
				return ws.send();
			})
			.then(() => { done(); })
			.catch(reason => {
				done({reason});
			});
	});
	it('should set all pixels to a colour (flash)', function(done) {
		Promise.resolve()
			.then(() => {
				return ws.flash({r:0x20,g:0x20,b:0x02});
			})
			.then(() => { done(); })
			.catch(reason => {
				done({reason});
			});
	});
	it('should return colors to buffer (resume)', function(done) {
		Promise.resolve()
			.then(() => {
				return ws.resume();
			})
			.then(() => { done(); })
			.catch(reason => {
				done({reason});
			});
	});
	it('should dump pixels');
	it('should dump a range of pixels');
	it('should set a range of pixels to a colour (flash region)');

	it('should set a range of pixels to a buffer', function(done) {
		Promise.resolve()
			.then(() => {
				return ws.setPixelBuf(
					0,
					[ { r:1, g:2, b:3 },
						{ r:4, g:5, b:6 },
						{ r:7, g:8, b:9 },
						{ r:1, g:2, b:3 },
						{ r:4, g:5, b:6 },
						{ r:7, g:8, b:9 },
						{ r:1, g:2, b:3 },
						{ r:4, g:5, b:6 },
					],
				);
			})
			.then(() => {
				return ws.send();
			})
			.then(() => { done(); })
			.catch(reason => {
				done({reason});
			});
	});
});


