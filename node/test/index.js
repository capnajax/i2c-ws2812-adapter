
const
	I2cWS281xDriver = require('../I2cWS281xDriver'),

	expect = require('chai').expect;

var ws = new I2cWS281xDriver

console.log('----');

describe('basic-comms', function() {
	it('should ack a syn', function(done) {
		ws.syn().then(done).catch(reason => done(reason));
	});
});


