//#define DEBUG

#include <Wire.h>
#include <Adafruit_NeoPixel.h>

#ifndef I2C_CHANNEL
#define I2C_CHANNEL 0x0B
#endif

#define CMD_SYN 		    ((uint8_t)0x01)
#define CMD_SETPIXEL_CT	((uint8_t)0x02)
#define CMD_SETPIN      ((uint8_t)0x03)
#define CMD_FLASH 		  ((uint8_t)0x10)
#define CMD_FLASH_RGN   ((uint8_t)0x11)
#define CMD_RESUME		  ((uint8_t)0x1F)
#define CMD_PIXEL_CLR	  ((uint8_t)0x20)
#define CMD_PIXEL_RNG	  ((uint8_t)0x21)
#define CMD_PIXEL_BUF   ((uint8_t)0x22)
#define CMD_RESET 			((uint8_t)0x7C)
#define CMD_DUMP			  ((uint8_t)0x7D)
#define CMD_DUMP_RNG	  ((uint8_t)0x7E)
#define CMD_SEND			  ((uint8_t)0x7F)

#define RSP_EMPTY           ((uint8_t)0x00)
#define RSP_ACK			        ((uint8_t)0x01)
#define RSP_NUM_BYTES       ((uint8_t)0x10)
#define RSP_ERR_BAD_STATE   ((uint8_t)0x30)
#define RSP_ERR_BAD_CMD	    ((uint8_t)0x31)
#define RSP_ERR_OUT_OF_RNG	((uint8_t)0x32)
#define RSP_ERR_NEGV_RNG	  ((uint8_t)0x33)
#define RSP_ERR_INTERNAL_ERR ((uint8_t)0x3f)
#define RSP_ERR_OVERFLOW    ((uint8_t)0x42)

#define RESPONSE_QUEUE_LENGTH 0x20

// pin for the Neopixel LED
#define DEFAULT_PIN 6

// responseScratch -- a space to use to compose two-byte responses for use by macros.

const int maxNumPixels = 0xd0;
const int pixelBytes = 3;
const int maxPixelBuf = maxNumPixels * pixelBytes;

uint8_t pin = DEFAULT_PIN;
uint8_t pixelsBuf[maxPixelBuf]; // remember this is an array of bytes
uint8_t responseQueue[RESPONSE_QUEUE_LENGTH];
uint8_t responseQueueReadOffset = 0;
uint8_t responseQueueWriteOffset = 0;
bool responseQueueOverflow = false;

uint16_t pixelCt = 1;

Adafruit_NeoPixel *leds = NULL;

// predeclared method signatures

uint16_t fill(uint32_t, uint16_t = 0, uint16_t = -1);
uint16_t readLength(uint8_t, uint16_t *, int &, bool = true);
void setRangeToColor(uint16_t, uint16_t, uint32_t, bool = true);

/**
 *  Send an 'ack' response, indicates the command has ben received and acted on
 */
inline void ack(uint8_t cmdNum) {
  uint8_t response[] = {RSP_ACK, cmdNum};
  queueResponse(2, response);
}

void i2cCmdHandler(int numBytes) {

  #ifdef DEBUG
    Serial.write("[i2cCmdHandler] called: ");
    Serial.print(numBytes);
    Serial.write(" bytes \n");
  #endif

  // this is to provide a workspace for receiving bytes
  union {
    uint32_t u32;
    uint16_t u16[2];
    uint8_t u8[4];
  };
  uint16_t rangeStart = 0;
  uint16_t rangeEnd = 0;
  int i;		// general-purpose counter
  uint8_t * ptr;	// general-purpose pointer
  int expectedCmdLength;
  bool error = false;

  if(numBytes < 2) {
    rejectBadCmd(0);
  }

  uint8_t command=(uint8_t)Wire.read();
  uint8_t cmdNum=(uint8_t)Wire.read();

  #ifdef DEBUG
    Serial.write("[i2cCmdHandler] command (");
    Serial.print(cmdNum, HEX);
    Serial.write("): ");
    Serial.println(command, HEX);
  #endif

  //
  // get ranges and command lengths
  //

  expectedCmdLength = 2;
  switch (command) {
  case CMD_SYN:
  case CMD_RESUME:
  case CMD_RESET:
  case CMD_SEND:
    break;
  case CMD_SETPIN:
    expectedCmdLength += 1;
    break;
  case CMD_SETPIXEL_CT:
    expectedCmdLength += 1;
    error = !readLength(cmdNum, u16, expectedCmdLength, false);
    rangeStart = u16[0];
    break;
  case CMD_PIXEL_BUF:
    expectedCmdLength += 2;
    error = !readRange(cmdNum, u16, expectedCmdLength);    
    rangeStart = u16[0];
    rangeEnd = u16[1];
    expectedCmdLength += (rangeEnd - rangeStart) * pixelBytes;
    break;
  case CMD_FLASH:
    expectedCmdLength += pixelBytes;
    break;
  case CMD_PIXEL_CLR:
    expectedCmdLength += 1 + pixelBytes;
    error = !readLength(cmdNum, u16, expectedCmdLength);
    rangeStart = u16[0];
    break;
  case CMD_PIXEL_RNG:
  case CMD_FLASH_RGN:
    expectedCmdLength += 2 + pixelBytes;
    error = !readRange(cmdNum, u16, expectedCmdLength);
    rangeStart = u16[0];
    rangeEnd = u16[1];
    break;
  default:
    // unknown command

    #ifdef DEBUG
      Serial.write("[i2cCmdHandler] unknown command: ");
      Serial.println(command);
    #endif

    error = true;
    rejectBadCmd(cmdNum);
  }

  //
  //  handle unthrown errors in range checking
  //

  #ifdef DEBUG
    Serial.write("[i2cCmdHandler] numBytes         : ");
    Serial.println(numBytes);
    Serial.write("[i2cCmdHandler] expectedCmdLength: ");
    Serial.println(expectedCmdLength);
  #endif

  if (!error && (numBytes != expectedCmdLength)) {
    // incorrect command length
    error = true;
    rejectBadCmd(cmdNum);
  }

  if (error) {
    #ifdef DEBUG
      Serial.write("[i2cCmdHandler] ERROR\n");
    #endif
    for(int i = 2; i < numBytes; i++) {
      Wire.read();
    }
    return;
  }

  //
  // now complete the command
  //

  switch (command) {
  case CMD_SYN:
    // do nothing. Will ack after switch block.
    #ifdef DEBUG
      Serial.println("[i2cCmdHandler] CMD_SYN");
    #endif
    break;

  case CMD_SETPIXEL_CT:
    pixelCt = rangeStart;
    #ifdef DEBUG
      Serial.print("[i2cCmdHandler] CMD_SETPIXEL_CT(");
      Serial.print(pixelCt);
      Serial.println(')');
    #endif
    break;

  case CMD_SETPIN:
    u8[0] = (uint8_t)Wire.read();
    if (pin != u8[0]) {
      pin = u8[0];
      leds = NULL;
    }
    break;

  case CMD_FLASH:
    if (leds == NULL) {
      resetLEDs();
    }
    readColor(u8);
    fill(u32);
    break;

  case CMD_FLASH_RGN:
    readColor(u8);
    setRangeToColor(rangeStart, rangeEnd, u32);
    break;

  case CMD_RESUME:
    setRangeToBufferedColor(0, pixelCt);
    break;

  case CMD_PIXEL_CLR:
    readColor(u8);
    #ifdef DEBUG
      Serial.write("[i2cCmdHandler] CMD_PIXEL_CLR read color:");
    #endif
    for (i = 0; i < pixelBytes; i++) {				
      pixelsBuf[rangeStart*pixelBytes+i]=u8[i];
      #ifdef DEBUG
        Serial.write(" ");
        Serial.print(u8[i], HEX);
      #endif
    }
    #ifdef DEBUG
      Serial.println();
    #endif
    break;

  case CMD_PIXEL_RNG:
    rangeStart = u16[0];
    rangeEnd = u16[0];
    readColor(u8);
    setRangeToColor(rangeStart, rangeEnd, u32);
    break;

  case CMD_PIXEL_BUF:
    for (i = rangeStart; i < rangeEnd; i++) {
      readColor(u8);
      setBufferedPixel(i, u32);
    }
    setRangeToBufferedColor(rangeStart, rangeEnd);
    break;

  case CMD_RESET:
    resetLEDs();
    resetWire();
    resetQueue();
    break;

  case CMD_SEND:
    // TODO
    // I don't like this but this is what gets us off the ground quickest.
    // This copies my buffer into a separate buffer for the Neopixel, and
    // then sends that. I want my colour store and the NeoPixel library to
    // work of the same buffer.
    ptr = pixelsBuf;
    if (leds == NULL) {
      resetLEDs();
    }
    for (i = 0; i < pixelCt; i++) {
      leds->setPixelColor(i, *(ptr++), *(ptr++), *(ptr++));
    }
    leds->show();
    break;

  default:
    error = true;
    rejectInternalError(cmdNum, 246);
    break;
  }

  if (!error) {
    ack(cmdNum);
  }
}

void i2cResponder() {

  if (responseQueueReadOffset == responseQueueWriteOffset) {
    // there is nothing to respond to. Zero out the queue offsets and send an
    // empty response
    writeEmptyResponse();
    responseQueueWriteOffset = 0;
    responseQueueReadOffset = 0;

  } else {
    #ifdef DEBUG
      Serial.println("[i2cResponder] sending all responses");
    #endif
    // send the complete queue of responses. If there is an overflow, send
    // an overflow notice at the end of the message.

    uint8_t response[RESPONSE_QUEUE_LENGTH + 4];
    size_t responseLen = 2;

    response[0] = RSP_NUM_BYTES;
    while(responseQueueReadOffset != responseQueueWriteOffset) {
      response[responseLen++] = responseQueue[responseQueueReadOffset++];
      if (responseQueueReadOffset > RESPONSE_QUEUE_LENGTH) {
        responseQueueReadOffset = 0;
      }
    }
    if (responseQueueOverflow) {
      response[responseLen++] = RSP_ERR_OVERFLOW;
    }
    response[1] = responseLen;

    #ifdef DEBUG
      Serial.write("[i2cResponder] response:");
      for (int i = 0; i < responseLen; i++) {
        Serial.write(' ');
        Serial.print(response[i], HEX);
      }
      Serial.println();
    #endif
    
    Wire.write(response, responseLen);
  }
}

inline uint16_t fill(uint32_t color, uint16_t start = 0, uint16_t end = -1) {
  if (-1 == end) {
    end = pixelCt - 1;
  }
  for (uint16_t i = 0; i <= end; i++) {
    leds->setPixelColor(i, color);
  }
  leds->show();
}

/**
 *  @method getBufferedPixel
 *  Gets a colour from the pixel buffer
 *  @param n the pixel number in the buffer
 *  @returns color
 */
inline uint32_t getBufferedPixel(uint16_t n) {
  uint32_t result = 0;
  for (int i = 0; i < pixelBytes; i++) {
    result = result << 8 | pixelsBuf[n*pixelBytes+i];
  }
  return result;
}

void queueResponse(int len, uint8_t * bytes) {
  int i;
  
  // first test for an overflow
  int lengthInQueue = responseQueueWriteOffset - responseQueueReadOffset;
  if (lengthInQueue < 0) {
    // in case the queue has wrapped
    lengthInQueue += RESPONSE_QUEUE_LENGTH;
  }

  if (lengthInQueue + len > RESPONSE_QUEUE_LENGTH) {
    // do not queue a response if it would cause the buffer to overflow.
    responseQueueOverflow = true;
    return;
  }

  // Now we've established there is space. Let's stick the data in.
  if (responseQueueWriteOffset == responseQueueReadOffset) {
    // the offsets are the same. Let's reset to zero.
    responseQueueReadOffset = 0;
    responseQueueWriteOffset = 0;
  }

  for (i = 0; i < len; i++) {
    responseQueue[responseQueueWriteOffset++] = bytes[i];
    responseQueueWriteOffset %= RESPONSE_QUEUE_LENGTH;
  }
}

/**
 *  Reads a color number from the wire into a four-byte array of uint8_t. 
 *  Bytes are 0rgb -- first byte is zero, second red, third green, fourth blue
 */
inline uint8_t readColor(uint8_t *buff) {
  buff[0] = (uint8_t)Wire.read();
  buff[1] = (uint8_t)Wire.read();
  buff[2] = (uint8_t)Wire.read();
}

/**
 *	Reads a length input from i2c. Length can be delivered in a byte or a 
 *	big-end word.
 *  @param range a pointer to an unsigned. The length will be be deposited here
 *    as a little-end word.
 *	@param expectedBytes a pointer to an expectedBytes counter. If the length
 *		is greater than 127, the expecterBytes counter will be incremented.
 *  @param rangeAgainstPixelCt set to true if checking range against set pixel
 *    count. Otherwise, check range against the maximum pixel length
 *	@return true if successful, false if not
 */ 
inline uint16_t readLength(
    uint8_t cmdNum, uint16_t * length, int &expectedBytes,
    bool rangeAgainstPixelCt = true) {

  #ifdef DEBUG
    Serial.write("[readLength] called, expectedBytes = ");
    Serial.println(expectedBytes);
  #endif

  uint16_t result = 0;
  uint8_t byteRead;

  byteRead = (uint8_t)Wire.read();
  #ifdef DEBUG
    Serial.write(" --> read ");
    Serial.println(byteRead, HEX);
  #endif
  if (byteRead & 0x80) {
    result = (byteRead & 0x7f) << 7;
    expectedBytes++;
    
    byteRead = (uint8_t)Wire.read();
    #ifdef DEBUG
      Serial.write(" --> read ");
      Serial.println(byteRead, HEX);
    #endif
    result += byteRead;
  } else {
    result = byteRead;
  }
  *length = result;

  #ifdef DEBUG
    Serial.write("[readLength] read ");
    Serial.print(result, HEX);
    Serial.write(", expectedBytes = ");
    Serial.println(expectedBytes);
    Serial.write("[readLength] result: ");
    Serial.print(result, HEX);
    Serial.write(", maximum: ");
    Serial.println((rangeAgainstPixelCt ? pixelCt : maxNumPixels), HEX);
  #endif

  if (result > (rangeAgainstPixelCt ? pixelCt : maxNumPixels)) {
    rejectOutOfRange(cmdNum);
    return false; 
  }
  return true;
}

/**
 *  Read a range input from i2c. The inputs from i2c can be in bytes, big-end
 *  words, or a combination.
 *  @param range a pointer to an array of two unsigned words. The range start
 *    and end will be deposited here as little-end words.
 *  @param expectedBytes a reference to an expectedBytes counter. If the range
 *    numbers are coming in as big-end words, the expectedBytes counter will
 *    be incremented, once for each big-end words.
 *  @return true if the range is valid, false if not. If the range is not valid,
 *    this will queue the response.
 */
inline bool readRange(uint8_t cmdNum, uint16_t * range, int &expectedBytes) {
  union {
    uint16_t rangeVal;
    uint8_t wireVal[2];
  };
  for (int i = 0; i < 2; i++) {
    wireVal[0] = (uint8_t)Wire.read();
    if (wireVal[0] & 0x80) {
      wireVal[1] = wireVal[0] & 0x7F;
      wireVal[0] = (uint8_t)Wire.read();
    } else {
      wireVal[1] = 0;
    }
    range[i] = rangeVal;
  }
  if (range[1] > maxNumPixels) {
    rejectOutOfRange(cmdNum);
    return false; 
  }
  if (range[0] > range[1]) {
    rejectNegativeRange(cmdNum);
    return false; 
  }
  return true;
}

/**
 *  Response to indicate the command could not be understood and was be ignored
 */
inline void rejectBadCmd(uint8_t cmdNum) {
  uint8_t response[] = {RSP_ERR_BAD_CMD, cmdNum};
  #ifdef DEBUG
    Serial.write('Rejecting bad command ');
    Serial.println(cmdNum);
  #endif
  queueResponse(2, response);
}

/**
 *  Response to indicate the command could not be executed because it was not
 *  valid
 */
inline void rejectBadState(uint8_t cmdNum) {
  uint8_t response[] = {RSP_ERR_BAD_STATE, cmdNum};
  queueResponse(2, response);
}

/**
 *  Response to indicate the pixel number is beyond the set pixel count.
 */
inline void rejectInternalError(uint8_t cmdNum, uint8_t errid) {
  uint8_t response[] = {RSP_ERR_INTERNAL_ERR, cmdNum, errid};
  queueResponse(3, response);
}

/**
 *  Response to indicate the pixel number is beyond the set pixel count.
 */
inline void rejectOutOfRange(uint8_t cmdNum) {
  uint8_t response[] = {RSP_ERR_OUT_OF_RNG, cmdNum};
  queueResponse(2, response);
}

/**
 *  Response to indicate the range is not valid because the range ends before
 *  it begins
 */
inline void rejectNegativeRange(uint8_t cmdNum) {
  uint8_t response[] = {RSP_ERR_NEGV_RNG, cmdNum};
  queueResponse(2, response);
}

void resetLEDs () {
  if (leds != NULL) {
    delete(leds);
  };
  leds = new Adafruit_NeoPixel(3, pin, NEO_GRB + NEO_KHZ800);
  leds->begin();
  leds->show();
  fill(0);
}

void resetWire () {
  Wire.begin(I2C_CHANNEL);
  Wire.onReceive(i2cCmdHandler);
  Wire.onRequest(i2cResponder);
}

void resetQueue() {
  uint8_t zero = 0;
  for (int i = 0; i < maxPixelBuf; i++) {
    pixelsBuf[i] = zero;
  }
  for (int i = 0; i < RESPONSE_QUEUE_LENGTH; i++) {
    responseQueue[i] = zero;
  }
  responseQueueReadOffset=0;
  responseQueueWriteOffset=0;
}

/**
 *  Gets a colour from the pixel buffer
 *  @param n the pixel number in the buffer
 *  @param uint32_t pixelColor
 */
inline uint32_t setBufferedPixel(uint16_t n, uint32_t pixelColor) {
  uint32_t result = 0;
  for (int i = 0; i < pixelBytes; i++) {
    pixelsBuf[n*pixelBytes+(2-i)] = (uint8_t)(pixelColor & 0xff);
    pixelColor >>= 8;
  }
}

/**
 *  Fill a range of the LED strip with a single colour
 *  @param start the start of the range
 *  @param end the end of the range
 *  @param color the colour to fill the range with.
 *  @param buffer set to true to save the colours to the buffer (set to false if
 *    just flashing the region with a colour and allow it to return to the
 *    original colour.
 */
void setRangeToColor(
  uint16_t start, uint16_t end, uint32_t color, bool buffer = true) {
  if (leds == NULL) {
    resetLEDs();
  }
  fill(color, start, end);
  if (buffer) {
    for (int i = start; i < end; i++) {
      setBufferedPixel(i, color);
    }
  }
}

/**
 *  Fill a range of the LED strip with a single colour
 *  @param start the start of the range
 *  @param end the end of the range
 */
void setRangeToBufferedColor(uint16_t start, uint16_t end) {
  if (leds == NULL) {
    resetLEDs();
  }
  for (int i = start; i < end; i++) {
    // TODO maybe this would be better accomplished as a memcopy operation
    // into the neopixel libraries own buffer
    leds->setPixelColor(i, getBufferedPixel(i));
    leds->show();
  }
}

/**
 *	Writes `num` queued bytes to the i2c bus and returns the value of the first byte.
 */
inline uint8_t writeEmptyResponse() {
  uint8_t emptyResponse[] = {RSP_EMPTY};
  Wire.write(emptyResponse, 1);
}

void setup() {
  #ifdef DEBUG
    Serial.begin(9600);
  #endif
  resetWire();
}

void loop() {
}


