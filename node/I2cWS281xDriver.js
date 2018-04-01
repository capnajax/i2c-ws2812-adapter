
const
	debug = require('debug')('I2cWS281xDriver'),
	i2c = require('i2c-bus'),
	_ = require('lodash'),

	SLAVE_ADDR = 0x0B,
	I2C_CHANNEL = 1, // the pi has two i2c devices, 0 and 1

	CMD_SYN 		= 0x01,
	CMD_SETPIXEL_CT	= 0x02,
	CMD_FLASH 		= 0x10,
	CMD_FLASH_RGN 	= 0x11,
	CMD_RESUME		= 0x1F,
	CMD_PIXEL_CLR	= 0x20,
	CMD_PIXEL_RNG	= 0x21,
	CMD_PIXEL_BUF 	= 0x22,
	CMD_DUMP		= 0x7D,
	CMD_DUMP_RNG	= 0x7E,
	CMD_SEND		= 0x7F,

	RSP_ACK			= 0x01,
	RSP_ERR_BAD_CMD	= 0x31,
	RSP_ERR_DUMP_ALREADY_QUEUED	= 0x41,
	RSP_DUMP_RNG_8	= 0x7D,
	RSP_DUMP_RNG_16	= 0x7E,

	// milliseconds to wait for a response
	RESPONSE_TIMEOUT = 200,
	// frequency to poll for a response
	RESPONSE_POLL	= 25;


/**
 *	Returns callback that resolves a promise but doesn't receive any data.
 */
var emptyCallback = (resolve, reject) => {
	return (err, data) => {
		if (err) {
			reject(err);
		} else {
			resolve();			
		}
	}
};

var I2cWS281xDriver = function I2cWS281xDriver() {

	this.bus = null;
	this.commandCounter = 0;

	/**
	 *	@property
	 *	Commands sent and awaiting a response. Sparse array, the index is the command number.
	 *	Commands are expressed as callbacks, call with (err, data) as the parameters when data
	 *	returns, or errors out. Allowing 255 comands. 256 is reserved as keeping it reserved helps
	 * 	to ensure the data stays in sync.
	 */
	this.commands = new Array(0xFF); 

	/**
	 *	@property lastCommandTime
	 *	The time the most recent command was made
	 */
	this.lastCommandTime = 0;

	/**
	 *	@property responsePollInterval
	 *	This interval polls for responses every `RESPONSE_POLL` milliseconds until it times out.
	 */
	this.responsePollInterval = null;
};

/**
 *	@method requestData
 *	Request data from the i2c device.
 *	@param {Number} length - the length of data to request.
 *	@return {Promise} - promise that resolves with (bytesRead, buffer)
 */
I2cWS281xDriver.prototype.requestData = function(channel, slave, length) {

	return new Promise((resolve, reject) => {

		Promise.resolve()
		.then(() => { return new Promise((res, rej) => {
				debug('openning channel');
				this.bus = i2c.open(channel, (err) => {err ? rej(err) : res()});
				debug('openned channel');
			})})
		.then(() => { return new Promise((res, rej) => {				
				debug(`buf.i2cRead(${slave}, ${length}, cb)`)
				this.bus.i2cRead(slave, length, Buffer.alloc(length), (err, bytesRead, buffer) => {

						debug('[requestData] err ==', err);
						debug('[requestData] bytesRead ==', bytesRead);
						debug('[requestData] buffer ==', buffer);

						if (err) {
							rej(err);
						} else {
							res({bytesRead: bytesRead, buffer: buffer});
						}
					});
				debug('read ok');
			})})
		.then((response) => { return new Promise((res, rej) => {
				debug('closing');
				this.bus.close((err) => {err ? rej(err) : res(response)});
				debug('closed');
			})})
		.then((response) => { resolve(response); })
		.catch((reason) => { reject(reason); })
	});
};

I2cWS281xDriver.prototype.pullResponse = function() {
 
	var self = this;

	return new Promise((resolve, reject) => {

		var responseType, cmdNum;

		self.requestData(I2C_CHANNEL, SLAVE_ADDR, 2)
		.then((response) => { return new Promise((res, rej) => {

				var cb;

				debug('[pullResponse] bytesRead ==', response.bytesRead);
				debug('[pullResponse] buffer ==', response.buffer);

				if (response.bytesRead == 2) {
					// what I expected. Let's parse it.
					responseType = response.buffer.readUInt8(0);
					cmdNum = response.buffer.readUInt8(1);
					// match the command number that generated this response.

					debug('[pullResponse] responseType ==', responseType);
					debug('[pullResponse] cmdNum ==', cmdNum);

					cb = this.commands[cmdNum];

					debug('[pullResponse] cb is', cb ? 'NOT null' : 'null');

					if ( ! cb ) {
						debug('[pullResponse] rejecting with 504');
						rej({	status : 504,
								error  : "Gateway Timeout",
								reason : "Command not matched"
							});
						return;
					}
					this.commands[cmdNum] = null;

					// now let's make the correct action for the response
					switch (responseType) {
					case RSP_ACK:
						cb(null);
						break;
					case RSP_ERR_BAD_CMD:


						// TODO



						break;

					case RSP_DUMP_RNG_8:


						// TODO


						break;


					case RSP_DUMP_RNG_16: 



						// TODO
						break;


					case RSP_ERR_DUMP_ALREADY_QUEUED:


						// TODO



						break;

					default:


						// TODO


						break;

					}


					res();




				} else {
					// unexpected behaviour
					debug("[pullResponse] rejecting with 500");
					rej({	status : 500,
							error  : "Internal Error",
							reason : "Device returned unexpected response"
						});


					// TODO create a reset command to send here.

				}

			})})
		.then(resolve)
		.catch(reject);

	})

};

I2cWS281xDriver.prototype.sendData = function(channel, slave, buffer) {

	return new Promise((resolve, reject) => {
		Promise.resolve()
		.then(() => { return new Promise((res, rej) => {
				debug('openning channel');
				this.bus = i2c.open(channel, (err) => {err ? rej(err) : res()});
				debug('openned channel');
			})})
		.then(() => { return new Promise((res, rej) => {
			this.bus.scan((err, devices) => {
				if (err) {
					debug("Error scanning bus:", err);
					rej(err);
				} else {
					debug("Scanned devices:", devices);
					res();
				}
			})
		})})
		.then(() => { return new Promise((res, rej) => {
				debug(`buf.i2cWrite(${slave}, ${buffer.length}, ${JSON.stringify(buffer.toJSON().data)}, cb)`)
				this.bus.i2cWrite(slave, buffer.length, buffer, (err) => {err ? rej(err) : res()});
				debug('write ok');
			})})
		.then(() => { return new Promise((res, rej) => {
				debug('closing');
				this.bus.close((err) => {err ? rej(err) : res()});
				debug('closed');
			})})
		.then(resolve)
		.catch(reason => { debug(reason) ; reject(reason); })
	})
};

I2cWS281xDriver.prototype.sendCommand = function(code, cb, buffer) {

	var self = this;

	return new Promise((resolve, reject) => {

		// If there's already a command in the queue that has this code, fail it so
		// I can reuse the code.
		var counter = self.commandCounter++;

		self.commandCounter%=0xFF;

		if (self.commands[counter]) {
			cb( {	status : 504,
					error  : "Gateway Timeout",
					reason : "Device did not respond. Reallocating command code."
				});
		}
		self.commands[counter] = cb;
		if ( null == buffer ) {
			buffer = Buffer.allocUnsafe(2);
			buffer.writeUInt8(code, 0);
			buffer.writeUInt8(counter, 1);
		} else {


			// TODO -- add the code and counter to the buffer



		}

		self.sendData(1, SLAVE_ADDR, buffer)
		.then((buffer) => {

				// we sent the command, now poll for the response
				// if ( ! self.responsePollInterval) {

					process.nextTick(_.bind(self.pullResponse, self));

				// 	self.responsePollInterval = setInterval(
				// 		_.bind(() => {
				// 				if (Date.now() > this.lastCommandTime + RESPONSE_TIMEOUT) {
				// 					clearInterval(this.responsePollInterval);
				// 					this.responsePollInterval = null;
				// 				}
				// 				this.pullResponse;
				// 			}, self), 
				// 		RESPONSE_POLL);
				// }
				// this.responsePollInterval = Date.now();

				return buffer;
			})
		.then(resolve)
		.catch((reason) => {
			self.commands[counter](reason);
			self.commands[counter] = null;
			reject(reason);
		});
	});
};

I2cWS281xDriver.prototype.syn = function() { 
	var self = this;
	return new Promise((resolve, reject) => {
		self.sendCommand(CMD_SYN, emptyCallback(resolve, reject), null);
	})
};

module.exports = I2cWS281xDriver;


