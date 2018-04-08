
const
	debug = require('debug')('I2cWS281xDriver'),
	i2c = require('i2c-bus'),
	statusCodes = require('web-status-codes'),
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
	RSP_OUT_OF_RNG	= 0x32,
	RSP_NEGV_RNG	= 0x33,
	RSP_ERR_DUMP_ALREADY_QUEUED	= 0x41,
	RSP_DUMP_RNG_8	= 0x7D,
	RSP_DUMP_RNG_16	= 0x7E,

	// milliseconds to wait for a response
	RESPONSE_TIMEOUT = 200,
	// frequency to poll for a response
	RESPONSE_POLL	= 25;

var expectingResponseSince = 0;


/**
 *	Returns callback that resolves a promise but doesn't receive any data.
 */
var emptyCallback = (resolve, reject) => {
	return (err, data) => {

		debug(`[emptyCallback] start err = ${err}`);
		debug(`[emptyCallback] start data = ${data}`);

		if (err) {
			reject && reject(err);
		} else {
			resolve && resolve(data);			
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
				debug('[requestData] openning channel');
				this.bus = i2c.open(channel, (err) => {err ? rej(err) : res()});
				debug('[requestData] openned channel');
			})})
		.then(() => { return new Promise((res, rej) => {				
				debug(`[requestData] buf.i2cRead(${slave}, ${length}, cb)`)
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
				debug('[requestData] read ok');
			})})
		.then((response) => { return new Promise((res, rej) => {
				debug('[requestData] closing');
				this.bus.close((err) => {err ? rej(err) : res(response)});
				debug('[requestData] closed');
			})})
		.then((response) => { resolve(response); })
		.catch((reason) => { reject(reason); })
	});
};

/**
 *	Requests a response from the i2c device. Responses are always to existing
 *	commands, each command has a callback in a queue so this method responds
 *	to those callbacks as well in the promise response.
 */
I2cWS281xDriver.prototype.pullResponse = function() {
 
	debug("[pullResponse] called");

	var self = this,
		cb = null,
		responseType, 
		cmdNum;

	self.requestData(I2C_CHANNEL, SLAVE_ADDR, 2)
	.then((response) => { return new Promise((res, rej) => {

			debug('[pullResponse] bytesRead ==', response.bytesRead);
			debug('[pullResponse] buffer ==', response.buffer);

			var responseObj = (cmdNum, status) => {
					var statusInfo = statusCodes.getStatusDetails(status);
						result = {
						commandNum: cmdNum,
						status: {
							code: status,
							series: statusInfo.series,
							message: statusInfo.text,
							isOk: ( statusInfo.series.startsWith(statusCodes.SUCCESS) )
						}
					};
					return result;
				};

			if (response.bytesRead == 2) {
				// what I expected. Let's parse it.
				responseType = response.buffer.readUInt8(0);
				cmdNum = response.buffer.readUInt8(1);

				if (0 == responseType && 255 == cmdNum) {
					// this is actually an empty response. If a response is expected, 
					// ask again in 100ms.
					debug('[pullResponse] got empty response.');
					if (expectingResponseSince + RESPONSE_TIMEOUT > Date.now()) {
						debug('[pullResponse] expecting response. trying again in 100ms');
						_.delay(_.bind(self.pullResponse, self), 100);
					}
					return;
				}
				expectingResponseSince == 0;

				// match the command number that generated this response.

				debug('[pullResponse] responseType ==', responseType);
				debug('[pullResponse] cmdNum ==', cmdNum);

				cb = this.commands[cmdNum];
				this.commands[cmdNum] == undefined;

				debug('[pullResponse] cb is', cb ? 'NOT null' : 'null');
				debug('[pullResponse] typeof cb is', typeof cb );

				if ( ! cb ) {
					debug('[pullResponse] rejecting with 504');
					res(responseObj(cmdNum, statusCodes.GATEWAY_TIMEOUT));

				} else {
					this.commands[cmdNum] = null;

					// now let's make the correct action for the response
					switch (responseType) {
					case RSP_ACK:
						debug('[pullResponse] got RSP_ACK');
						res(responseObj(cmdNum, statusCodes.NO_CONTENT));
						break;
					case RSP_ERR_BAD_CMD:
						debug('[pullResponse] got BAD_REQUEST');
						res(responseObj(cmdNum, statusCodes.BAD_REQUEST));
						break;

					case RSP_OUT_OF_RNG:
					case RSP_NEGV_RNG:
						debug('[pullResponse] got RSP_OUT_OF_RNG');
						res(responseObj(cmdNum, statusCodes.REQUESTED_RANGE_NOT_SATISFIABLE));
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


						res(response);

						break;

					}

				}
				// make sure there aren't any other responses waiting. If this call gets an empty
				// response, there shouldn't be any subsequent calls.
				_.delay(_.bind(self.pullResponse, self));


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
	.then((response) => {
		debug("[pullResponse] calling back with response", response);
		cb && cb(null, response);
	})
	.catch(reason => {
		debug("[pullResponse] throwing for reason", reason);
		cb && cb(reason);
		throw reason;
	});

};

I2cWS281xDriver.prototype.sendData = function(channel, slave, buffer) {

	debug("[sendData] start");

	return new Promise((resolve, reject) => {
		Promise.resolve()
		.then(() => { return new Promise((res, rej) => {
				debug('[sendData] openning channel');
				this.bus = i2c.open(channel, (err) => {err ? rej(err) : res()});
				debug('[sendData] openned channel');
			})})
		.then(() => { return new Promise((res, rej) => {
			this.bus.scan((err, devices) => {
				if (err) {
					debug("[sendData] Error scanning bus:", err);
					rej(err);
				} else {
					debug("[sendData] Scanned devices:", devices);
					res();
				}
			})
		})})
		.then(() => { return new Promise((res, rej) => {
				debug(`[sendData] buf.i2cWrite(${slave}, ${buffer.length}, ${JSON.stringify(buffer.toJSON().data)}, cb)`)
				this.bus.i2cWrite(slave, buffer.length, buffer, (err) => {err ? rej(err) : res()});
				debug('[sendData] write ok');
			})})
		.then(() => { return new Promise((res, rej) => {
				debug('[sendData] closing');
				this.bus.close((err) => {err ? rej(err) : res()});
				debug('[sendData] closed');
			})})
		.then(resolve)
		.catch(reason => { debug(`[sendData] rejected: ${reason}`) ; reject(reason); })
	})
};


/**
 *	@method sendCommand
 *	Sends a command to the i2c device. This method takes a callback and returns
 *	a promise -- these have two different functions. The callback is the result
 *	of the command, and the promise is the result of *sending* the command.
 *	@param {Number} code - the 8-bit command code to send
 *	@param {Buffer|String} [buffer] - a buffer that includes the data to send
 *		with the command. Not required for all commands.
 *	@param {Function} [cb] - the callback to call when the adapter responds
 *		to the command.
 *	@return {Promise} promise that resolves when the command is sent to the i2c
 *		device.
 */
I2cWS281xDriver.prototype.sendCommand = function(code, buffer, cb) {

	debug("[sendCommand] called on code:", '0x'+code.toString(16));

	var self = this;

	return new Promise((resolve, reject) => {

		// If there's already a command in the queue that has this code, fail it so
		// I can reuse the code.
		var counter = self.commandCounter++;

		if (_.isFunction(buffer)) {
			if (_.isNil(cb)) {
				cb = buffer;
				buffer = undefined;
			} else {
				reject("Internal error 321: Too many callbacks");
			}
		}

		self.commandCounter%=0xFF;

		if (self.commands[counter]) {
			self.commands[counter]( 
				{	status : 504,
					error  : "Gateway Timeout",
					reason : "Device did not respond. Reallocating command code."
				});
		}
		self.commands[counter] = cb;
		if ( _.isNil(buffer) ) {
			buffer = Buffer.allocUnsafe(2);
			buffer.writeUInt8(code, 0);
			buffer.writeUInt8(counter, 1);
		} else {
			var newBuffer = Buffer.allocUnsafe(buffer.length+2);
			newBuffer.writeUInt8(code, 0);
			newBuffer.writeUInt8(counter, 1);
			buffer.copy(newBuffer, 2);
			buffer = newBuffer;
		}

		self.sendData(1, SLAVE_ADDR, buffer)
		.then(buffer =>{ expectingResponseSince = Date.now(); _.bind(self.pullResponse, self)(); })
		.catch(reason => {
			debug("[sendCommand] REJECTING with reason ==", reason);
			reject(reason);
		});
	});
};

I2cWS281xDriver.prototype.syn = function syn() { 
	var self = this;
	return new Promise((resolve, reject) => {
		self.sendCommand(CMD_SYN, emptyCallback(resolve, reject));
	});
};

I2cWS281xDriver.prototype.setPixelCount = function setPixelCount(newPixelCount) {
	var self = this;
	return new Promise((resolve, reject) => {
		var buffer, code, cb;
		if (newPixelCount <= 0x7f) {
			buffer = Buffer.allocUnsafe(1);
			buffer.writeUInt8(newPixelCount);
		} else {
			buffer = Buffer.allocUnsafe(2);
			buffer.writeUInt16BE(newPixelCount|0x8000);
		}
		self.sendCommand(CMD_SETPIXEL_CT, buffer, emptyCallback(resolve, reject))
	});
};

module.exports = I2cWS281xDriver;


