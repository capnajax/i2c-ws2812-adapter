
const
	debug = require('debug')('test'),
	expect = require('chai').expect,
	fs = require('fs');

var	ws; // require called later, after testing for prereqs

console.log();
console.log();
console.log('-----------');
console.log();

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
			//I2cWS281xDriver = require('../I2cWS281xDriver');
			ws = new (require('../I2cWS281xDriver'))();
		}
		next();
	});
})

describe('basic-comms', function() {

	it('should ack a syn', function(done) {
		ws.syn().then((response) => {
			debug("[should ack a syn] response ==", JSON.stringify(response));
			expect(response).to.not.be.null;
			expect(response.status.code).to.be.equal(204);
			expect(response.status.series).to.be.equal('2xx Success');
			expect(response.status.isOk).to.be.equal(true);
			done();
		}).catch(reason => done(reason));
	});
	it('should reject a bad command', function(done) {
		ws.sendCommand(0x0D, (err, data) => {
			expect(err).to.be.null;
			debug("[should reject a bad command] data ==", JSON.stringify(data));
			expect(data).to.not.be.null;
			expect(data.status.code).to.be.equal(400);
			expect(data.status.series).to.be.equal('4xx Client Error');
			expect(data.status.isOk).to.be.equal(false);
			debug("[should reject a bad command] got to the end");
			done();
		})
		.then(()=>{
			// command was successful, let's wait for the results now.
		})
		.catch(err => {
			done(err);
		});
	});
	it('should set a pixel count', function(done) {
		Promise.resolve()
		.then(() => { return ws.setPixelCount(1); })
		.then((response) => {
				debug("[should set a pixel count 1] response ==", JSON.stringify(response));
				expect(response).to.not.be.undefined;
				expect(response.status.code).to.be.equal(204);
				expect(response.status.series).to.be.equal('2xx Success');
				expect(response.status.isOk).to.be.equal(true);
			})
		.then(() => { return ws.setPixelCount(2); })
		.then((response) => {
				debug("[should set a pixel count 2] response ==", JSON.stringify(response));
				expect(response).to.not.be.undefined;
				expect(response.status.code).to.be.equal(204);
				expect(response.status.series).to.be.equal('2xx Success');
				expect(response.status.isOk).to.be.equal(true);
			})
		.then(() => { return ws.setPixelCount(51); })
		.then((response) => {
				debug("[should set a pixel count 3] response ==", JSON.stringify(response));
				expect(response).to.not.be.undefined;
				expect(response.status.code).to.be.equal(204);
				expect(response.status.series).to.be.equal('2xx Success');
				expect(response.status.isOk).to.be.equal(true);
			})
		.then(() => { return ws.setPixelCount(81); })
		.then((response) => {
				debug("[should set a pixel count 4] response ==", JSON.stringify(response));
				expect(response).to.not.be.undefined;
				expect(response.status.code).to.be.equal(204);
				expect(response.status.series).to.be.equal('2xx Success');
				expect(response.status.isOk).to.be.equal(true);
			})
		.then(() => { return ws.setPixelCount(101); })
		.then((response) => {
				debug("[should set a pixel count 5] response ==", JSON.stringify(response));
				expect(response).to.not.be.undefined;
				expect(response.status.code).to.be.equal(204);
				expect(response.status.series).to.be.equal('2xx Success');
				expect(response.status.isOk).to.be.equal(true);
			})
		.then(() => { return ws.setPixelCount(126); })
		.then((response) => {
				debug("[should set a pixel count 6] response ==", JSON.stringify(response));
				expect(response).to.not.be.undefined;
				expect(response.status.code).to.be.equal(204);
				expect(response.status.series).to.be.equal('2xx Success');
				expect(response.status.isOk).to.be.equal(true);
			})
		.then(() => { return ws.setPixelCount(127); })
		.then((response) => {
				debug("[should set a pixel count 7] response ==", JSON.stringify(response));
				expect(response).to.not.be.undefined;
				expect(response.status.code).to.be.equal(204);
				expect(response.status.series).to.be.equal('2xx Success');
				expect(response.status.isOk).to.be.equal(true);
			})
		.then(() => { return ws.setPixelCount(128); })
		.then((response) => {
				debug("[should set a pixel count 8] response ==", JSON.stringify(response));
				expect(response).to.not.be.undefined;
				expect(response.status.code).to.be.equal(204);
				expect(response.status.series).to.be.equal('2xx Success');
				expect(response.status.isOk).to.be.equal(true);
			})
		.then(done)
		.catch(reason => done(reason));
	});
	it('should fail to set a pixel count if it\'s too high', function(done) {
		ws.setPixelCount(29999).then((response) => {
			debug("[should fail to set a pixel count if it\'s too high] response ==", JSON.stringify(response));
			expect(response).to.not.be.null;
			expect(response.status.code).to.be.equal(416);
			expect(response.status.series).to.be.equal('4xx Client Error');
			expect(response.status.isOk).to.be.equal(false);
			done();
		}).catch(reason => done(reason));
	});
	it('should set a single pixel to a colour', function(done) {
		Promise.resolve()
		.then(() => { return ws.setPixelCount(1); })
		.then((response) => {
				debug("[should fail to set a pixel count if it\'s too high] response ==", JSON.stringify(response));
				expect(response).to.not.be.null;
				expect(response.status.code).to.be.equal(204);
				expect(response.status.series).to.be.equal('2xx Success');
				expect(response.status.isOk).to.be.equal(true);
			})
		.then(() => { return ws.setPixelColor(0, 66,55,44); })
		.then((response) => {
				debug("[should fail to set a pixel count if it\'s too high] response ==", JSON.stringify(response));
				expect(response).to.not.be.null;
				expect(response.status.code).to.be.equal(204);
				expect(response.status.series).to.be.equal('2xx Success');
				expect(response.status.isOk).to.be.equal(true);
			})
		.then(() => { return ws.send(); })
		.then((response) => {
				debug("[should fail to set a pixel count if it\'s too high] response ==", JSON.stringify(response));
				expect(response).to.not.be.null;
				expect(response.status.code).to.be.equal(204);
				expect(response.status.series).to.be.equal('2xx Success');
				expect(response.status.isOk).to.be.equal(true);
			})
		.then(done)
		.catch(reason => done(reason));
	});
	it('should set all pixels to a colour');
	it('should dump pixels');
	it('should dump a range of pixels');
	it('should set a range of pixels to a colour');
	it('should set all pixels to a buffer');
	it('should set a range of pixels to a buffer');
	it('should refuse to set a range of pixels > pixelCount');
	it('should refuse to set a range of pixels that ends before it starts');

});


