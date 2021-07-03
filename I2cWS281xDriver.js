
const
  debug = require('debug')('I2cWS281xDriver'),
  debugResponse = require('debug')('I2cWS281xDriver:response')
  debugCallbacks = require('debug')('I2cWS281xDriver:callbackMgmt')
  i2c = require('i2c-bus'),
  statusCodes = require('web-status-codes'),
  _ = require('lodash'),

  SLAVE_ADDR = 0x0B,
  I2C_CHANNEL = 1, // the pi has two i2c devices, 0 and 1

  CMD_SYN 		    = 0x01,
  CMD_SETPIXEL_CT	= 0x02,
  CMD_FLASH 		  = 0x10,
  CMD_FLASH_RGN 	= 0x11,
  CMD_RESUME		  = 0x1F,
  CMD_PIXEL_CLR	  = 0x20,
  CMD_PIXEL_RNG	  = 0x21,
  CMD_PIXEL_BUF 	= 0x22,
  CMD_DUMP		    = 0x7D,
  CMD_DUMP_RNG	  = 0x7E,
  CMD_SEND		    = 0x7F,

  RSP_ACK			    = 0x01,
  RSP_ERR_BAD_CMD	= 0x31,
  RSP_OUT_OF_RNG	= 0x32,
  RSP_NEGV_RNG	  = 0x33,
  RSP_ERR_DUMP_ALREADY_QUEUED	= 0x41,
  RSP_DUMP_RNG_8	= 0x7D,
  RSP_DUMP_RNG_16	= 0x7E,

  // milliseconds to wait for a response
  RESPONSE_TIMEOUT = 500,
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
   *	Queue of i2c transactions to be completed one at a time. Each item is a function.
   */
  this.txQueue = [];

  /**
   *	@property txLock
   *	Set to true when there is a transaction in progress.
   */
  this.txLock = false;

  /**
   *	@property
   *	Commands sent and awaiting a response. Sparse array, the index is the command number.
   *	Commands are expressed as callbacks, call with (err, data) as the parameters when data
   *	returns, or errors out. Allowing 255 comands. 256 is reserved as keeping it reserved helps
   * 	to ensure the data stays in sync.
   */
//	this.commands = new Array(0xFF); 

  /**
   *	@property
   *	Commands sent and awaiting a response. Array of objects with `cmdNum`, `cb`, and `time`.
   *	Callbacks are always called with `(err, data)` as parameters when either data returns or 
   *	it errors out. Command number is always a single byte between `0` and `0xF8`.
   */
  this.commandsWaiting = [];

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

  var self = this;
};


/**
 *	@method expireCommands.
 *	@private
 *	Scans the commands waiting to determine if there are any that have expired. Intended to be
 *	run on an interval.
 */
I2cWS281xDriver.prototype.expireCommands = function expireCommands() {

  debugCallbacks('[expireCommands] called.');

  var	self = this,
    expiryTime = Date.now() - RESPONSE_TIMEOUT,
    expiredCommands = [];
  self.commandsWaiting.forEach(command => {
      if (command.time < expiryTime) {
        expiredCommands.push(command);
      }
    });
  expiredCommands.forEach(command => {
    debugCallbacks("[expireCommands] expiring command:", command);
    command.cb && command.cb( 
      {	status : 504,
        error  : "Gateway Timeout",
        reason : "Device did not respond. Reallocating command code."
      });
  });
  self.commandsWaiting = _.difference(self.commandsWaiting, expiredCommands);
  if (_.isEmpty(self.commandsWaiting)) {
    debugCallbacks('[expireCommands] command queue empty.');
    clearInterval(this.expireInterval);
    this.expireInterval = null;
  }
}

/**
 *	@method allocateCommandNum
 *	@private
 *	Allocate a command number. Note that this allocation is short-lived -- it
 *	has the same timeout as a waiting command, so use this command number 
 * 	quickly.
 *	@return a command number that is unused.
 */
I2cWS281xDriver.prototype.allocateCommandNum = function allocateCommandNum() {

  debugCallbacks('[allocateCommandNum] called.');

  var self = this,
    cmdNum,
    foundCmd;

  // this loop usually won't iterate more than once.
  for (cmdNum = self.commandCounter + 1; cmdNum != self.commandCounter; cmdNum++) {

    cmdNum %= 0xF0;

    foundCmd = _.find(self.commandsWaiting, ['cmdNum', cmdNum]);
    if (!_.isNil(foundCmd)) {
      // found an allocated command, maybe it was allocated already?
      continue;
    }

    self.commandsWaiting.push({cmdNum: cmdNum, time: Date.now()});
    self.commandCounter = cmdNum;
    return cmdNum;
    break;
  }

  // if we get here, the queue is full
  throw {	status : 429,
      error  : "Too many requests",
      reason : "Unable to allocate a command number."
    };
};

/**
 *	@method registerCommand
 *	@private
 *	register that a command is waiting.
 *	@param {Number} cmdNum - the command number. The command number should
 *		have been previously allocated by `allocateCommandNum`
 *	@param {Function} cb - the callback of the command
 */
I2cWS281xDriver.prototype.registerCommand = function registerCommand(cmdNum, cb) {

  debugCallbacks('[registerCommand] called on cmdNum', cmdNum);
  debugCallbacks('[registerCommand] typeof cb ==', typeof cb);

  var self = this,
    foundCmd = _.find(self.commandsWaiting, ['cmdNum', cmdNum]);

  if (_.isNil(foundCmd)) {
    // this should not happen, commands should have been allocated first, 
    // but it's not harmful.
    debugCallbacks('[registerCommand] WARNING: unallocated cmdNum');
    self.commandsWaiting.push({
        cmdNum: cmdNum,
        time: Date.now(),
        cb: cb
      });
  } else {
    if(_.isNil(foundCmd.cb)) {
      // allocating a command number leaves a command with no callback
      // registered.
      foundCmd.time = Date.now(); // reset the clock
      foundCmd.cb = cb;
    } else {
      // this is bad. I just stomped on another command
      throw { status: 500,
          error: "Internal error",
          reason: "Registered an already-registered command number",
          data: {foundCmd: foundCmd}
        };
    }
  }

  if (_.isNil(self.expireInterval)) {
    debugCallbacks('[registerCommand] starting expireInterval');
    self.expireInterval = setInterval(_.bind(self.expireCommands, self), 50);
  }
}

/**
 *	@method respondToCommand
 *	@private
 *	Respond to a command. If the command has already been expired, it won't
 *	won't respond.
 *	@param {number} cmdNum - the command number to respond to
 *	@param {?(string|object)} err - the error
 *	@param {?(string|object)} data - response data
 *	@return {boolean} true if responded, false if not. 
 */
I2cWS281xDriver.prototype.respondToCommand = function respondToCommand(cmdNum, err, data) {

  debugCallbacks("[responseToCommand] called on cmdNum, err, data ==", cmdNum, err, data);

  var self = this,
    foundCmd = _.find(self.commandsWaiting, ['cmdNum', cmdNum]);

  if (foundCmd) {
    debugCallbacks("[respondToCommand] responding to cmdNum", cmdNum, foundCmd);
    if (foundCmd.cb) {
      debugCallbacks("[respondToCommand] ...", cmdNum);
      foundCmd.cb(err, data);
    } 
    self.commandsWaiting = _.without(self.commandsWaiting, foundCmd);
  } else {
    debugCallbacks("[respondToCommand] failed to respond to cmdNum", cmdNum);
  }

}

/**
 *	@method unlock
 *	@private
 *	Unlock the i2c device and, if any exist, do the next thing on the queue.
 */
I2cWS281xDriver.prototype.unlock = function unlock() {
  var self = this;
  self.txLock = false;
  process.nextTick(() => {
    if (self.txQueue.length) {
      debug("[unlock] Getting job off queue");
      (self.txQueue.shift())()
    } else {
      // self.close();
    }
  });
}

I2cWS281xDriver.prototype.open = function open(res, rej) {
  var self = this,
    alreadyLocked = self.txLock
  if (null == self.bus) {
    self.txLock = true;
    debug('[open] openning channel');
    self.bus = i2c.open(I2C_CHANNEL, (err) => {
      if (err) {
        debug('[open] ERROR:', err);
        alreadyLocked || self.unlock();
        rej(err);
      } else { 
        debug('[open] channel open');
        alreadyLocked || self.unlock();
        res();
      }
    });
  } else {
    res();
  }
}

/**
 *	@method close
 *	@private
 *	Close a connection to the i2c device
 */
I2cWS281xDriver.prototype.close = function close() {
  var self = this;
  debug(`[close] closing connection`);
  if (self.bus) {
    self.txLock = true;
    self.bus.close(err => {
      err && debug(err);
      self.bus = null;
      self.txLock = false;
    });
  }
}

/**
 *	@method requestData
 *	@private
 *	Request data from the i2c device.
 *	@param {Number} length - the length of data to request.
 *	@return {Promise} - promise that resolves with (bytesRead, buffer)
 */
I2cWS281xDriver.prototype.requestData = function requestData(length) {

  var self = this;

  if (this.txLock) {

    return new Promise((resolve, reject) => {

      self.txQueue.push(() => {
        self.requestData(length)
        .then(resolve)
        .catch(reject);
      });

    });

  } else {
    // we can proceed -- there's no request waiting
    self.txLock = true;
    return new Promise((resolve, reject) => {

      Promise.resolve()
      .then(() => { return new Promise((res, rej) => {
          self.open(res, rej);
        })})
      .then(() => { return new Promise((res, rej) => {				
          debugResponse(`[requestData] buf.i2cRead(${SLAVE_ADDR}, ${length}, cb)`)
          self.bus.i2cRead(SLAVE_ADDR, length, Buffer.alloc(length), (err, bytesRead, buffer) => {

              debugResponse('[requestData] err ==', err);
              debugResponse('[requestData] bytesRead ==', bytesRead);
              debugResponse('[requestData] buffer ==', buffer);

              if (err) {
                rej(err);
              } else {
                res({bytesRead: bytesRead, buffer: buffer});
              }
            });
          debugResponse('[requestData] read ok');
        })})
      .then((response) => { 
        resolve(response); 
        self.unlock();
      })
      .catch(reason => { 
        debugResponse(`[requestData] rejected: ${reason}`);
        self.close();
      })
    });
  }
};

/**
 *	Requests a response from the i2c device. Responses are always to existing
 *	commands, each command has a callback in a queue so this method responds
 *	to those callbacks as well in the promise response.
 */
I2cWS281xDriver.prototype.pullResponse = function() {
 
  debugResponse("[pullResponse] called");

  var self = this,
    cb = null,
    responseType, 
    cmdNum;

  self.requestData(2)
  .then((response) => { return new Promise((res, rej) => {

      debugResponse('[pullResponse] bytesRead ==', response.bytesRead);
      debugResponse('[pullResponse] buffer ==', response.buffer);

      var responseObj = (cmdNum, status) => {
          var statusInfo = statusCodes.getStatusDetails(status);
            result = {
            cmdNum: cmdNum,
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
          debugResponse('[pullResponse] got empty response.');
          if (expectingResponseSince + RESPONSE_TIMEOUT > Date.now()) {
            debugResponse('[pullResponse] expecting response. trying again in 100ms');
            _.delay(_.bind(self.pullResponse, self), 100);
          } else {
            debugResponse('[pullResponse] expecting response. Got none. NO MORE TESTS');
          }
          return;
        }
        expectingResponseSince == 0;

        // match the command number that generated this response.

        debugResponse('[pullResponse] responseType ==', responseType);
        debugResponse('[pullResponse] cmdNum ==', cmdNum);

        // now let's make the correct action for the response
        switch (responseType) {
        case RSP_ACK:
          debugResponse('[pullResponse] got RSP_ACK');
          res(responseObj(cmdNum, statusCodes.NO_CONTENT));
          break;
        case RSP_ERR_BAD_CMD:
          debugResponse('[pullResponse] got BAD_REQUEST');
          res(responseObj(cmdNum, statusCodes.BAD_REQUEST));
          break;

        case RSP_OUT_OF_RNG:
        case RSP_NEGV_RNG:
          debugResponse('[pullResponse] got RSP_OUT_OF_RNG');
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
        // make sure there aren't any other responses waiting. If this call gets an empty
        // response, there shouldn't be any subsequent calls.
        _.delay(_.bind(self.pullResponse, self));



      } else {
        // unexpected behaviour
        debugResponse("[pullResponse] rejecting with 500");
        rej({	status : 500,
            error  : "Internal Error",
            reason : "Device returned unexpected response"
          });


        // TODO create a reset command to send here.

      }

    })})
  .then((response) => {
    debugResponse("[pullResponse] calling back with response", response);
    self.respondToCommand(cmdNum, null, response);
  })
  .catch(reason => {
    debugResponse("[pullResponse] throwing for reason", reason);
    self.respondToCommand(cmdNum, reason, null);
    throw reason;
  });

};

I2cWS281xDriver.prototype.sendData = function(buffer) {

  var self = this;

  debug("[sendData] start");

  if (self.txLock) {

    return new Promise((resolve, reject) => {

      self.txQueue.push(() => {
        self.sendData(buffer)
        .then(resolve)
        .catch(reject);
      });

    });

  } else {

    return new Promise((resolve, reject) => {
      Promise.resolve()
      .then(() => { return new Promise((res, rej) => {
          self.open(res, rej);
        })})
      // .then(() => { return new Promise((res, rej) => {
      // 	self.bus.scan((err, devices) => {
      // 		if (err) {
      // 			debug("[sendData] Error scanning bus:", err);
      // 			rej(err);
      // 		} else {
      // 			debug("[sendData] Scanned devices:", devices);
      // 			res();
      // 		}
      // 	})
      // })})
      .then(() => { return new Promise((res, rej) => {
          debug(`[sendData] buf.i2cWrite(${SLAVE_ADDR}, ${buffer.length}, ${JSON.stringify(buffer.toJSON().data)}, cb)`)
          self.bus.i2cWrite(SLAVE_ADDR, buffer.length, buffer, (err) => {err ? rej(err) : res()});
        })})
      .then((response) => { 
        debug("[sendData] resolving with response");
        resolve(); 
        this.unlock();
      })
      .catch(reason => { 
        debug(`[sendData] rejected: ${reason}`);
        self.close();
       });
    })
  }
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
    var cmdNum = self.allocateCommandNum();

    if (_.isFunction(buffer)) {
      if (_.isNil(cb)) {
        cb = buffer;
        buffer = undefined;
      } else {
        reject("Internal error 321: Too many callbacks");
      }
    }

    self.registerCommand(cmdNum, cb);

    if ( _.isNil(buffer) ) {
      buffer = Buffer.allocUnsafe(2);
      buffer.writeUInt8(code, 0);
      buffer.writeUInt8(cmdNum, 1);
    } else {
      var newBuffer = Buffer.allocUnsafe(buffer.length+2);
      newBuffer.writeUInt8(code, 0);
      newBuffer.writeUInt8(cmdNum, 1);
      buffer.copy(newBuffer, 2);
      buffer = newBuffer;
    }

    self.sendData(buffer)
    .then(() => { 
      debug(buffer.toJSON()); 
      expectingResponseSince = Date.now();
      _.bind(self.pullResponse, self)(); 
      debug("[sendCommand] resolving");
      resolve();
    })
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
  debug('[setPixelCount] called on newPixelCount ==', newPixelCount);
  var self = this;
  return new Promise((resolve, reject) => {
    var buffer, code, cb;
    if (newPixelCount <= 0x7f) {
      buffer = Buffer.allocUnsafe(1);
      buffer.writeUInt8(newPixelCount, 0);
    } else {
      buffer = Buffer.allocUnsafe(2);
      buffer.writeUInt16BE(newPixelCount|0x8000, 0);
    }
    self.sendCommand(CMD_SETPIXEL_CT, buffer, emptyCallback(resolve, reject))
      .catch((reason) => {
        // this means I failed to send the command, not the command returning failure.
        debug("FAILED WITH REASON", reason), reject(reason);
      });
  });
};

I2cWS281xDriver.prototype.setPixelColor = function setPixelColor(pixelNum, r, g, b) {
  debug('[setPixelColor] called on pixelNum ==', pixelNum, "r,g,b ==", r, g, b);
  var self = this;
  return new Promise((resolve, reject) => {
    var buffer, code, cb, colorOffset;
    if (pixelNum <= 0x7f) {
      colorOffset = 1;
      buffer = Buffer.allocUnsafe(4);
      buffer.writeUInt8(pixelNum);
    } else {
      colorOffset = 2;
      buffer = Buffer.allocUnsafe(5);
      buffer.writeUInt16BE(pixelNum|0x8000);
    }
    buffer.writeUInt8(b, colorOffset++);
    buffer.writeUInt8(r, colorOffset++);
    buffer.writeUInt8(g, colorOffset++);
    self.sendCommand(CMD_PIXEL_CLR, buffer, emptyCallback(resolve, reject))
      .catch((reason) => { debug("FAILED WITH REASON", reason); reject(reason) });
  });
}

I2cWS281xDriver.prototype.send = function send() {
  debug('[send] called');
  var self = this;
  return new Promise((resolve, reject) => {
    self.sendCommand(CMD_SEND, emptyCallback(resolve, reject));
  });
}

module.exports = I2cWS281xDriver;



