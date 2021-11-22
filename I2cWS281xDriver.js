'use strict';

import { Buffer } from 'buffer';
import colorConvert from 'color-convert';
import EventEmitter from 'events';
import i2c from 'i2c-bus';
import _ from 'lodash';

const
  SLAVE_ADDR = 0x0B,  // the i²c standard really needs better terminology
  I2C_CHANNEL = 1,    // the pi has two i²c devices, 0 and 1

  RX_BUFFER_SIZE = 0x10, // length of the receive buffer

  COLOR_SPACE = {
    grayscale: 'grayscale',
    rgb: 'rgb',
    rgbw: 'rgbw',
    hsl: 'hsl',
    hsv: 'hsv',
    css: 'css'
  },

  COMMAND = {
    syn:            0x01,
    setPixelCt:     0x02,
    setPin:         0x03,
    flash:          0x10,
    flashRgn:       0x11,
    resume:         0x1f,
    setPixelColor:  0x20,
    setPixelRange:  0x21,
    setPixelBuf:    0x22,
    reset:          0x7c,
    send:           0x7f
  },

  PURGE_REASON = {
    badCommand: 'BAD_COMMAND',
    bufferOverflow: 'RX_BUFFER_OVERFLOW',
    internalError: 'INTERNAL_ERROR',
    outOfRange: 'OUT_OF_RANGE',
    negativeRange: 'NEGATIVE_RANGE',
    timeout:    'TIMEOUT'
  },

  RESPONSE = {
    empty:            0x00,
    ack:              0x01,
    numBytes:         0x10,
    errBadState:      0x30,
    errBadCommand:    0x31,
    errOutOfRange:    0x32,
    errNegativeRange: 0x33,
    errInternalError: 0x3f,
    errOverflow:      0x42
  },

  // milliseconds to wait for a response
  RESPONSE_TIMEOUT = 500,
  // milliseconds to allow a transaction to lock
  TXLOCK_MAX = 100,
  // frequency to poll for a response
  RESPONSE_POLL	= 25;

var expectingResponseSince = 0;

/**
 *	Returns callback that resolves a promise but doesn't receive any data.
 */
var emptyCallback = (resolve, reject) => {
  return (err, data) => {

    if (err) {
      reject && reject(err);
    } else {
      resolve && resolve(data);			
    }
  }
};

class GenericLogger {

  constructor(prefix, suffix, defaultStyle) {
    this.prefix = prefix;
    if (undefined === defaultStyle) {
      this.defaultStyle = suffix;
      this.suffix = undefined;
    } else {
      this.suffix = suffix;
      this.defaultStyle = defaultStyle;
    }
  };

  log() {
    let ar;
    if (arguments[0] && Array.isArray(arguments[0])) {
      ar = arguments[0];
    } else {
      ar = Array.prototype.slice.call(arguments);
    }
    let logStr = this.prefix || '';
    for (let a of ar) {
      if (typeof a !== 'object') {
        a = {text: a, style: this.defaultStyle};
      }
      logStr += ` ${a.style?`\x1b[${a.style}m`:''}${a.text}\x1b[0m`;
    }
    if (undefined !== this.suffix) {
      logStr += this.suffix;
    }
    console.log(logStr);
  }
}

class I2CLogger extends GenericLogger {

  constructor() {
    super(' \x1b[90;107m𝕀²ℂ\x1b[0m', '94');
  };

  close() {
    this.log('closed channel');
  }

  error(description, reason) {
    this.log('ERROR', description + ':', reason);
  }

  open() {
    this.log('openned channel', I2C_CHANNEL);
  }

  preclose() {
    this.log('closing channel');
  }

  preopen() {
    this.log('opening channel', I2C_CHANNEL);
  }

  read(numBytes, buffer) {
    let message = ['read---', 
      '0x' + numBytes.toString(16).padStart(2, '0'),
      'bytes:'
    ];
    message = message.map(m => {
      return {text: m, style: '32;1'};
    });
    for (let i = 0; i < numBytes; i++) {
      message.push({
        text: buffer.readUInt8(i).toString(16).padStart(2, '0'),
        style: '32'
      });
    }
    this.log(message);
  }

  write(numBytes, buffer) {
    let message = ['writing', 
      '0x' + numBytes.toString(16).padStart(2, '0'),
      'bytes:'
    ];
    message = message.map(m => {
      return {text: m, style: '94;1'};
    });
    for (let i = 0; i < numBytes; i++) {
      message.push({
        text: buffer.readUInt8(i).toString(16).padStart(2, '0'),
        style: '94'
      });
    }
    this.log(message);
  }
}
const i2cLog = new I2CLogger()

class CommandLogger extends GenericLogger {

  constructor(command, cmdNum) {
    super(' \x1b[102;40mCMD\x1b[0m', '96');
    this.command = command;
    this.cmdNum = cmdNum;
  };

  hexByte(number) {
    return number.toString(16).padStart(2, '0');
  }

  cmdCard() {
    return {
      text: `#${this.hexByte(this.cmdNum)}[${this.hexByte(this.command)}]`,
      style: '1'
    };
  }

  completedTwice(reason) {
    let message = [this.cmdCard(), 'completed twice.'];
    if (reason) {
      message.push('Extra completion'),
      message.push({
        text: 'FAILED\x1b[0m:',
        style: '91'
      }),
      message.push(JSON.stringify(reason));
    }
    this.log(message);
  }

  create() {
    this.log(this.cmdCard(), 'created');
  }

  outstanding(outstandingKeys) {
    this.log(
      this.cmdCard(), 'outstanding commands:', outstandingKeys.join(', '));
  }

  send() {
    this.log(this.cmdCard(), 'sending');
  }

  rejected(reason) {
    this.log(this.cmdCard(), 
      { text: 'FAILED:', style: '91,40'}, reason);
  }

  resolved() {
    this.log(this.cmdCard(), 'success');
  }
}


/**
 * @class I2cCommand
 * Represents a single command sent to the I2C driver. Invoked by the driver
 * itself, not meant to be instantiated directly.
 * @private
 */
class I2cCommand extends EventEmitter {

  /**
   * @constructor
   * @param {byte} command the command to send
   * @param {byte} cmdNum the command number allocated for this command
   * @param {I2cWS281xDriver} driver the driver used to manage and send commands
   */
  constructor(command, cmdNum, driver) {
    super();
    this.command = command;
    this.cmdTime = null;
    this.cmdNum = cmdNum;
    this.completed = false;
    this.driver = driver
    this.params = [];
    // the first two "params" are the command and the cmdNum
    this.setParam(1, this.command);
    this.setParam(1, this.cmdNum);

    this.cmdLog = new CommandLogger(command, cmdNum);

    let self = this;

    // this promise is returned from command.send()
    this.commandPromise = new Promise((resolve, reject) => {
      self.resolveSend = message => {
        this.cmdLog.resolved();
        resolve(message);}
      self.rejectSend = reason => {
        this.cmdLog.rejected(reason);
        reject(reason);}
    });
    this.cmdLog.create();
  }

  /**
   * @method purgeCallback
   * Called by driver when this command is completed
   */
   completeCallback(message) {
    if (!this.completed) {
      this.completed = true;
      this.resolveSend && this.resolveSend(message);
      this.removeAllListeners();
    } else if (this.completed) {
      // TODO really should handle this better
      this.cmdLog.completedTwice();
      console.warn(`Command ${this.command} completed twice. ` + 
        'Possible memory leak?');
        this.removeAllListeners();
    }
  }
  
  isExpired() {
    return (this.cmdTime && (Date.now() - this.cmdTime > RESPONSE_TIMEOUT));
  }

  /**
   * @method purgeCallback
   * Called by driver when this command is purged
   */
  purgeCallback(reason = PURGE_REASON.timeout) {
    if (this.completed) {
      this.cmdLog.completedTwice(reason);
    } else {
      this.rejectSend({err: reason, command: this.command, params: this.params});
    }
    this.removeAllListeners();
    this.completed = true;
  }

  /**
   * 
   * @param {I2cWS281xDriver} driver 
   * @returns 
   */
  send() { 

    this.cmdLog.send();

    let self = this;
    this.cmdTime = Date.now();

    let totalBytes = _.reduce(
      this.params, (acc, t) => {return acc + t.bytes;}, 0);
    let cmdBuffer = Buffer.alloc(totalBytes);
    let bufferCursor = 0;
    for (let p of self.params) {
      if (_.isArray(p.value)) {
        for (let i = 0; i < p.bytes; i++) {
          if (p.value.length > i) {
            cmdBuffer.writeUInt8(p.value[i], bufferCursor++);
          } else {
            cmdBuffer.writeUInt8(0x00, bufferCursor++);
          }
        }
      } else {
        let remainingValue = p.value;
        let byteStack = [];
        for (let i = 0; i < p.bytes; i++) {
          let byte = remainingValue & 0x7f;
          remainingValue >>= 7;
          byteStack.push(i === 0 ? byte : byte | 0x80);
        }
        while (byteStack.length) {
          let byte = byteStack.pop();
          cmdBuffer.writeUInt8(byte, bufferCursor++);
        }
      }
    }

    self.driver.push(cmdBuffer);

    return this.commandPromise;
  }

  /**
   * Add a parameter to the command. Parameters must be added in order.
   * @param {Integer} numBytes number of bytes in the message
   * @param {Integer|Array} value can be an integer (then it'll write that
   *  integer, expressed a big-end integer of `numBytes` bytes), or an 
   *  array of integers between 0 and 255.
   */
  setParam(numBytes, value) {
    if (this.cmdTime) {
      // can't add parameters to an already-sent command
      let message = `I2cCommand ${this.command} cannot add parameters ` +
        'after sending command';
      throw new Exception(message);
    } else {
      this.params.push({bytes: numBytes, value});
    }
  }

  /**
   * Add a pixel number parameter to the command. Parameters must be added in
   * order.
   * @param {Integer} pixelNum the pixel number value. Must be between 0 and
   *  0x7ff. This method will calculate the number of pixels needed to encode
   *  the number.
   * @param {Integer|Array} value can be an integer (then it'll write that
   *  integer, expressed a big-end integer of `numBytes` bytes), or an 
   *  array of integers between 0 and 255.
   */
  setPixelNumParam(pixelNum) {
    const rangeMessage = 'Pixel number must be an integer between 0 and 0x7ff.';
    if (!_.isInteger(pixelNum)) {
      throw new Error('Pixel number not an integer. ' + rangeMessage);
    } else if (pixelNum < 0) {
      throw new Error('Pixel number is negative. ' + rangeMessage);
    } else if (pixelNum <= 0x7F) {
      this.setParam(1, pixelNum);
    } else if (pixelNum <= 0x7FFF) {
      this.setParam(2, pixelNum + 0x8000);
    } else {
      throw new Error('Pixel Number is out of range. ' + rangeMessage);
    }
  }

  /**
   * Add a color parameter to the command. Parameters must be added in order.
   * @param {Integer|Array|Object|String} color the color. Several format are
   *  accepted.
   * @param {String} colorSpace. Optional, but suggested. Accepted are `rgb`,
   *  `rgbw`, `cmyk`, 
   */
  setColorParam(color, colorSpace) {
    let colorConverted = this.driver.convertColor(color, colorSpace);
    this.setParam(3, [
      (colorConverted >> 16) & 0xff,
      (colorConverted >> 8) & 0xff,
      (colorConverted) & 0xff
    ]);
  }
}

/**
 * @class I2cWS281xDriver
 */
class I2cWS281xDriver {

  constructor(pin = 6) {

    this.bus = null;

    /**
     * @property pin
     * Pin on the arduino used for the WS2812 leds
     * @private
     */
    this.pin = pin;

    /**
     * @property txQueue
     * Queue of i2c transactions to be completed one at a time. Each item is a
     * command number.
     * @private
     */
    this.txQueue = [];

    /**
     *	@property txLock
     *	Set to a timeout or to true when there is a transaction in progress.
     */
    this.txLock = null;

    /**
     * @property
     * Commands created. These are created when queued, and removed when either
     * responded to, an overflow is reported, or, if expired, expired commands
     * cleaned up. Commands numbers range from 1 to 255. Command 0 is reserved.
     * @private
     */
    this.commands = new Array(0xFF); 

    /**
     * @property commandCounter
     * Used for allocating command numbers
     * @private
     */
    this.commandCounter = 1;

    /**
     * @property responsePollInterval
     * This interval polls for responses every `RESPONSE_POLL` milliseconds
     * until it times out or is canceled. This interval should be canceled
     * when there are no commands awaiting responses.
     * @private
     */
    this.responsePollInterval = null;

    /**
     * @property rxByteQueue
     * @private
     * Bytes received from the slave device
     */
    this.rxByteQueue = [];
  }

  async #checkOutstandingCommands() {
    let hasOutstandingCommands = false;
    // test for outstanding () commands
    for (let i = 0; i < 0xFF; i++) {
      if (this.commands[i]) {
        // test outstanding commands for timeouts
        if (this.commands[i].isExpired()) {
          this.deallocateCommand(i, PURGE_REASON.timeout);
        } else {
          hasOutstandingCommands = true;
        }
      }
    }

    // if no commands are outstanding, stop
    if (!hasOutstandingCommands) {
      clearInterval(this.responsePollInterval);
      this.responsePollInterval = null;
    }
  } 
  
  /**
   * @method allocateCmdNum
   * @private
   */
  allocateCommandNum() {
    let startCommandCounter = this.commandCounter;
    while (this.commands[this.commandCounter++]) {
      if (this.commandCounter > 0xFF) {
        this.commandCounter = 1;
      }
      if (startCommandCounter === this.commandCounter) {
        throw new Error('Command queue full');
      }
    }
    return this.commandCounter;
  }

  /**
   * @method awaitResponse
   * Returns a promise that resolves or rejects when a command succeeds or
   * fails.
   * @param {I2cCommand}
   * @return {Promise}
   */
  awaitResponse(command) {
    this.pollForResponses();
    return new Promise((resolve, reject) => {
      command.commandPromise.then(resolve).catch(reject)
    });
  }

  /**
   * @method byteLength
   * Returns the number of bytes needed to encode a number
   * @param {Number} integer between 0 and 0x7FFF
   * @return byteLength
   */
  byteLength(number) {
    if (number <= 0x7F) {
      return 1;
    } else if (number <= 0x7FFF) {
      return 2;
    } else {
      throw new Error('number out of range');
    }
  }

  /**
   *	@method close
   *	Close a connection to the i2c device
   */
  close() { return new Promise((resolve, reject) => {
    let self = this;
    if (self.bus) {
      self.txLock = true;
      i2cLog.preclose();
      self.bus.close(err => {
        i2cLog.close();
        self.bus = null;
        self.txLock = false;
        err ? reject(err) : resolve();
      });
    } else {
      resolve();
    }
  });}

  /**
   * Convert a color to an unsigned integer as required by this driver.
   * @param {Integer|String|Array|Object} color the color to convert 
   * @param {String} [colorSpace] the format of the color to convert. Recommended,
   *  but if not provided, this function will guess.
   * @return {Integer} the color as an integer.
   */
  convertColor(color, colorSpace) {

    let result = null;

    if (!colorSpace) {
      // guess the format
      if (_.isInteger(color)) {
        colorSpace = 'rgb'; // currently only rgb pixels are supported but if we
                        // add rgbw pixels later, it should be assumed rgbw when
                        // we're using rgbw, and rgb when using rgb.
      } else if (_.isObject(color)) {
        if (_.has(color, 'r') || _.has(color, 'red')) {
          colorSpace = 'rgb';
        } else if (_.has(color, 'h') || _.has(color, 'hue')) {
          if (_.has(color, 'l') || _.has(color, 'lightness')) {
            colorSpace = 'hsl';
          } else {
            colorSpace = 'hsb';
          }
        }
      } else if (_.isArray(color)) {
        switch (color.length) {
        case 1:
          colorSpace = 'grayscale';
          break;
        case 3:
          colorSpace = 'rgb';
          break;
        case 4:
          // if rgbw is supported, this should change to rgbw when using rgbw
          // pixels
          colorSpace = 'cmyk';
        default:
          // do nothing. Format underterminable.
        }
      } else if (_.isString(color)) {
        if (color.startsWith('#')) {
          colorSpace = 'rgb';
        } else {
          colorSpace = 'css';
        }
      }
    }
    if (!colorSpace) {
      throw new Error('Undeterminable format');
    }

    switch(colorSpace) {
    case COLOR_SPACE.grayscale:
      if (_.isArray(color)) {
        color = _.first(color);
      }
      if (!_.isInteger(color)) {
        color = Math.floor(color * 256);
      }
      if (color >= 0 && color < 256) {
        result = color + color << 8 + color << 16;
      }
      break;

    case COLOR_SPACE.rgb:
      if (_.isInteger(color) && color >= 0 && color <= 0x00ffffff) {
        result = color;
      } else if (_.isArray(color) && color.length === 3) {
        result = color[0] << 16 + color[1] < 8 + color[2];
      } else if (_.isString(color)) {
        if (color.startsWith('#')) {
          color = color.substr(1);
        }
        switch (color.length) {
        case 3:
          result = [
            _.parseInt(color.substr(0, 1), 16) * 0x11,
            _.parseInt(color.substr(1, 1), 16) * 0x11,
            _.parseInt(color.substr(2, 1), 16) * 0x11
          ];
          break;
        case 6:
          result = [
            _.parseInt(color.substr(0, 2), 16),
            _.parseInt(color.substr(2, 2), 16),
            _.parseInt(color.substr(4, 2), 16)
          ];
          break;
        default:
          throw new Error('RGB Strings are #RRGGBB, RRGGBB, #RGB, or RGB');
        }

      } else if (_.isObject(color)) {
        result = 
          ((color.r || color.red || 0) << 16) +
          ((color.g || color.green || 0) << 8) +
           (color.b || color.blue || 0);
      }
      break;

    case COLOR_SPACE.rgbw:
      throw new Error('rgbw colors not supported yet');

    case COLOR_SPACE.cmyk:
      if (_.isInteger(color)) {
        throw new Error('cmyk colors as integers not supported');
      } else if (_.isArray(color) && color.length === 4) {
        result = colorConvert.cmyk.rgb(color);
      } else if (_.isObject(color)) {
        result = colorConvert.cmyk.rgb(
            color.c || color.cyan || 0,
            color.m || color.magenta || 0,
            color.y || color.yellow || 0,
            color.k || color.black || 0);
      }
      break;

    case COLOR_SPACE.hsl:
      if (_.isInteger(color)) {
        result = colorConvert.hsl.rgb(
            color & 0xff0000 >> 16,
            color & 0xff00 >> 8,
            color & 0xff
          );
      } else if (_.isArray(color) && color.length === 3) {
        result = colorConvert.hsl.rgb(color);
      } else if (_.isObject(color)) {
        result = colorConvert.cmyk.hsl(
            color.h || color.hue || 0,
            color.s || color.saturation || 0,
            color.l || color.lightness || 0);
      }
      break;

    case COLOR_SPACE.hsv:
      if (_.isInteger(color)) {
        result = colorConvert.hsv.rgb(
            color & 0xff0000 >> 16,
            color & 0xff00 >> 8,
            color & 0xff
          );
      } else if (_.isArray(color) && color.length === 3) {
        result = colorConvert.hsv.rgb(color);
      } else if (_.isObject(color)) {
        result = colorConvert.cmyk.hsl(
            color.h || color.hue || 0,
            color.s || color.saturation || 0,
            color.v || color.b || color.value || color.brightness || 0);
      }
      break;

    case COLOR_SPACE.css:
      if (_.isString(color)) {
        result = colorConvert.css.rgb(color);
      }
      break;
    }

    if (_.isArray(result)) {
      result = result[0] << 16 | result[1] << 8 | result[2];
    } else if (_.isNil(result)) {
      throw new Error('Failed to parse color value');
    }

    return result;
  }

  /**
   * @method deallocateAllCommands
   * Removes all outstanding commands from the queue and purges them
   * @param {String} reason 
   */
  deallocateAllCommands(reason) {
    for (let i = 1; i <=0xFF; i++) {
      if (this.commands[i]) {
        this.deallocateCommand(i, reason);
      }
    }
  }

  /**
   * @method deallocateCommand
   * Removes a command
   * @param {Integer} cmdNum 
   * @param {String} reason the reason code the command is being deallocated. If
   *  provided, the command will be purged before this is called.
   */
  deallocateCommand(cmdNum, reason) {
    if (reason) {
      // purge a command
      let command = this.commands[cmdNum];
      if (command) {
        command.purgeCallback(reason);
      } else {
        isErrorState = true;
      }
    }
    this.commands[cmdNum] = 0;
    this.#checkOutstandingCommands();
  }

  flash(color, colorSpace) {
    let command = this.newCommand(COMMAND.flash);
    // TODO I should handle multiple formats for colour encoding.

    // TODO to support RGBW, this needs to be 3 or 4
    command.setColorParam(color, colorSpace);
    command.send();
    return this.awaitResponse(command);
  }

  flashRegion(start, end, color, colorSpace) {
    let command = this.newCommand(COMMAND.flashRgn);
    command.setPixelNumParam(start);
    command.setPixelNumParam(end);
    command.setColorParam(color, colorSpace);
    return this.awaitResponse(command);
  }

  /**
   * @method getData
   * Gets data from i2c device and handle it appropriately
   */
   async getData() {

    let self = this;
    let rxBuffer = Buffer.alloc(RX_BUFFER_SIZE);

    if (!self.bus) {
      await self.open();
    }

    while (true) {
      let read = await new Promise(resolve => {
        self.bus.i2cRead(SLAVE_ADDR, RX_BUFFER_SIZE, rxBuffer,
          (err, bytesRead, buffer) => {
            
            if (err) {
              i2cLog.error('reading data', err);
            } else {
              i2cLog.read(bytesRead, buffer);
            }

            resolve({err, bytesRead, buffer});
          }
        );
      });
      if (read.bytesRead && rxBuffer.readUInt8(0)) {
        let dbg_added = 0;
        for (let i = 2; i < rxBuffer.readUInt8(1); i++) {
          dbg_added++;
          this.rxByteQueue.push(rxBuffer.readUInt8(i));
        }
      } else {
        // buffer is empty
        break;
      }
    }

    // handle the received data appropriately

    queueLoop:
    while (this.rxByteQueue.length > 0) {

      let rxType = this.rxByteQueue.shift();

      if (null !== rxType) {
        let cmdNumRead = this.rxByteQueue.shift();
        if (null === cmdNumRead) {
          // we're short a byte. Push everything back into the rxQueue
          this.rxByteQueue.unshift(cmdNumRead);
          this.rxByteQueue.unshift(rxType);
          break queueLoop;

        } else {
          // we got two good bytes. Now let's try to handle it

          switch (rxType) {
          case RESPONSE.empty:
            // if the response type is `empty`, the next byte MUST be 0xFF.
            if (cmdNumRead !== 0xFF) {
              this.deallocateAllCommands(PURGE_REASON.badState);
            }
            break;
            
          case RESPONSE.ack:
            { // acknowledge a command
              let command = this.commands[cmdNumRead];
              if (command) {
                delete this.commands[cmdNumRead];
                command.completeCallback();
              } else {
                this.deallocateAllCommands(PURGE_REASON.badState);
              }
            }
            break;

          case RESPONSE.errBadState:
            this.deallocateAllCommands(PURGE_REASON.badState);
            break;

          case RESPONSE.errBadCommand:
            this.deallocateCommand(cmdNumRead, PURGE_REASON.badCommand);
            break;
          case RESPONSE.errOutOfRange:
            this.deallocateCommand(cmdNumRead, PURGE_REASON.outOfRange);
            break;
          case RESPONSE.errNegativeRange:
            this.deallocateCommand(cmdNumRead, PURGE_REASON.negativeRange);
            break;
          case RESPONSE.internalError:
            this.deallocateCommand(cmdNumRead, PURGE_REASON.internalError);
            break;
            
          case RESPONSE.errOverflow:
            this.deallocateAllCommands(PURGE_REASON.bufferOverflow);
            break;

          default:
            // not a known response code
            this.deallocateAllCommands(PURGE_REASON.badState);
          }
        }
      } else {
        break queueLoop;
      }
    }
  }

  /**
   * @method open
   * Open the i2c connection
   */
  open() { return new Promise((resolve, reject) => {
    let self = this;
    self.txLock = true;
    i2cLog.preopen();
    self.bus = i2c.open(I2C_CHANNEL, (err) => {
      i2cLog.open();
      self.txLock = false;
      err ? reject(err) : resolve();
    });
  });}

  /**
   * @method newCommand
   * @private
   * @param {Integer} cmdType 
   * @returns {Command}
   */
  newCommand(cmdType) {
    let cmdNum = this.allocateCommandNum();
    let command = new I2cCommand(cmdType, cmdNum, this);
    this.commands[cmdNum] = command;
    return command;
  }

  async pollForResponses() {
    let self = this;
    if (!self.responsePollInterval) {
      self.responsePollInterval = setInterval(async function () {

        // test for responses
        await self.getData(); // this gets and processes responses.

        // at this point, all commands that remain are outstanding or expired

        self.#checkOutstandingCommands();

      }, RESPONSE_POLL);
    }
  }

  /**
   * @method push
   * Sends a command, by i2c, to the arduino.
   * @param {I2cCommand} command 
   */
  push(cmdBuffer) {
    i2cLog.write(cmdBuffer.length, cmdBuffer);
    this.bus.i2cWrite(SLAVE_ADDR, cmdBuffer.length, cmdBuffer, ()=>{});
  }

  /**
   * @method rawCmd
   * Send a raw byte sequence to the i2c device. This should only be used used
   * for testing
   * @deprecated Only intended for use in testing
   * @param {Integer} cmd the command to send
   * @param {Integer} [numBytes=0] the number of bytes to send as a parameter
   * @param {Integer|Array} [byets] the bytes to send. Only required if numBytes
   *  is greater than zero
   * @returns {Promise}
   */
  rawCmd(cmd, numBytes, bytes) {
    let command = this.newCommand(cmd);
    if (numBytes) {
      command.setParam(numBytes, bytes);
    }
    command.send();
    return this.awaitResponse(command);
  }

  reset() {
    let command = this.newCommand(COMMAND.reset);
    return this.awaitResponse(command);
  }

  resume() {
    let command = this.newCommand(COMMAND.resume);
    command.send();
    return this.awaitResponse(command);
  }
  /**
   * @method syn
   * ping the arduino
   * @return {Promise}
   */
  syn() {
    let command = this.newCommand(COMMAND.syn);
    command.send();
    return this.awaitResponse(command);
  }

  setPin(pin) {
    let command = this.newCommand(COMMAND.setPixelCt);
    command.setParam(1, pin);
    return this.awaitResponse(command);
  }

  /**
   * @method send
   * Note this is a 'send' from the Arduino's perspective -- it sends a buffer
   * to the pixels
   * @returns a promise
   */
  send() {
    let command = this.newCommand(COMMAND.send);
    command.send();
    return this.awaitResponse(command);
  }

  setPixelBuf(offset, pixels, colorSpace) {
    let command = this.newCommand(COMMAND.setPixelBuf);
    command.setPixelNumParam(offset);
    command.setPixelNumParam(offset + pixels.length);
    for (let i of pixels) {
      command.setColorParam(i, colorSpace)
    }
    command.send();
    return this.awaitResponse(command);
  }

  /**
   * @method setPixelCt
   * Set the number of pixels
   * @param {Integer} pixelCt maximum pixel count 
   * @returns {Promise}
   */
  setPixelCount(pixelCt) {
    let command = this.newCommand(COMMAND.setPixelCt);
    command.setParam(this.byteLength(pixelCt), pixelCt);
    command.send();
    return this.awaitResponse(command);
  }

  setPixelColor(pixel, color, colorSpace) {
    let command = this.newCommand(COMMAND.setPixelColor);
    command.setPixelNumParam(pixel);
    command.setColorParam(color, colorSpace);
    command.send();
    return this.awaitResponse(command);
  }

  setPixelRange(offset, numPixels, color, colorSpace) {
    let command = this.newCommand(COMMAND.setPixelRange);
    command.setPixelNumParam(offset);
    command.setPixelNumParam(offset + numPixels);
    command.setColorParam(color, colorSpace);
    return this.awaitResponse(command);
  }

  /**
   * @method unlockTx
   * @private
   */
  unlockTx() {
    if (this.txLock) {
      clearTimeout(this.txLock)
      this.txLock = null;
    }
  }
}

export default I2cWS281xDriver;
