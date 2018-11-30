
#include <Wire.h>
#include <Adafruit_NeoPixel.h>

#define I2C_CHANNEL 0x0B

#define CMD_SYN 		((uint8_t)0x01)
#define CMD_SETPIXEL_CT	((uint8_t)0x02)
#define CMD_FLASH 		((uint8_t)0x10)
#define CMD_FLASH_RGN 	((uint8_t)0x11)
#define CMD_RESUME		((uint8_t)0x1F)
#define CMD_PIXEL_CLR	((uint8_t)0x20)
#define CMD_PIXEL_RNG	((uint8_t)0x21)
#define CMD_PIXEL_BUF 	((uint8_t)0x22)
#define CMD_DUMP		((uint8_t)0x7D)
#define CMD_DUMP_RNG	((uint8_t)0x7E)
#define CMD_SEND		((uint8_t)0x7F)

#define RSP_ACK			((uint8_t)0x01)
#define RSP_ERR_BAD_CMD	((uint8_t)0x31)
#define RSP_OUT_OF_RNG	((uint8_t)0x32)
#define RSP_NEGV_RNG	((uint8_t)0x33)
#define RSP_ERR_DUMP_ALREADY_QUEUED	((uint8_t)0x41)
#define RSP_DUMP_RNG_8	((uint8_t)0x7D)
#define RSP_DUMP_RNG_16	((uint8_t)0x7E)

#define RESPONSE_QUEUE_LENGTH 0x10
#define MAX_PIXEL_BUF 0x280

// pin for the Neopixel LED
#define PIN 6

// responseScratch -- a space to use to compose two-byte responses for use by macros.

uint8_t pixelBytes=3;
uint8_t pixelsBuf[MAX_PIXEL_BUF];
uint8_t responseQueue[RESPONSE_QUEUE_LENGTH];
uint8_t responseQueueReadOffset=0;
uint8_t responseQueueWriteOffset=0;

uint16_t dumpCursor=0;
uint16_t dumpStop=0;
enum nextResponse_t:uint8_t { 
	FIRST,
	DUMP_SIZE_BYTE,
	DUMP_SIZE_WORD,
	DUMP
};
nextResponse_t nextResponse = FIRST;

uint16_t i = 0;
uint16_t pixelCt = 1;

Adafruit_NeoPixel leds = Adafruit_NeoPixel(3, PIN, NEO_GRB + NEO_KHZ800);

void queueResponse(int len, uint8_t * bytes) {
	int i;

	// first find a spot we can write that data in the queue. Return if there is no space.
	if (responseQueueWriteOffset > responseQueueReadOffset) {
		// write is still ahead of read. Let's see if there's room at the end.
		if (responseQueueWriteOffset + len > RESPONSE_QUEUE_LENGTH) {
			// ok, this is an overflow for sure. Let's not queue this one.
			return;
		} 
	} else if (responseQueueWriteOffset == responseQueueReadOffset) {
		// read has caught up to write. We can bring them back to zero.
		responseQueueReadOffset = responseQueueWriteOffset = 0;
		if (RESPONSE_QUEUE_LENGTH < len) {
			// this message is just too long to begin with. Don't queue it. 
			return;	
		}
	} else {
		// write is looped behind read
		if (responseQueueWriteOffset + len > responseQueueReadOffset) {
			// not enough room. No need to queue
			return;
		}
	}

	for (i = 0; i < len; i++) {
		responseQueue[responseQueueWriteOffset++] = bytes[i];
	}
}

// each command will be size (bytes), command number (uint8_t), and the command itself
inline void ack(uint8_t cmdNum) {
	uint8_t response[] = {RSP_ACK, cmdNum};
	queueResponse(2, response);
}

inline void rejectBadCmd(uint8_t cmdNum) {
	uint8_t response[] = {RSP_ERR_BAD_CMD, cmdNum};
	queueResponse(2, response);
}
inline void rejectOutOfRange(uint8_t cmdNum) {
	uint8_t response[] = {RSP_OUT_OF_RNG, cmdNum};
	queueResponse(2, response);
}
inline void rejectNegativeRange(uint8_t cmdNum) {
	uint8_t response[] = {RSP_NEGV_RNG, cmdNum};
	queueResponse(2, response);
}

/**
 *	Writes `num` queued bytes to the i2c bus and returns the value of the first byte.
 */
inline uint8_t writeBytesToI2C(int num) {
	int i, firstByte;

	if (responseQueueReadOffset + num >= RESPONSE_QUEUE_LENGTH) {
		responseQueueReadOffset = 0;
	}

	firstByte = responseQueue[responseQueueReadOffset];
	Wire.write(&(responseQueue[responseQueueReadOffset]), num);
	responseQueueReadOffset += num;
	return firstByte;
}
/**
 *	Writes `num` queued bytes to the i2c bus and returns the value of the first byte.
 */
inline uint8_t writeEmptyResponse() {
	uint8_t emptyResponse[] = {0x00,0xff};
	Wire.write(emptyResponse, 2);
}

void i2cResponder() {
	// for the most part, we're going to assume each response is two bytes, 
	// because it's usually and ACK and a command number, so the master
	// should know to request two bytes at a time, unless the previous
	// request is asking for a dump.

	uint8_t responseType;

	switch (nextResponse) {

	case FIRST:

		if ( responseQueueReadOffset == responseQueueWriteOffset) {
			writeEmptyResponse();
			return;
		} else {
		}
		responseType = writeBytesToI2C(2);
		switch (responseType) {
		case RSP_DUMP_RNG_8:
			nextResponse = DUMP_SIZE_BYTE;
			break;
		case RSP_DUMP_RNG_16:
			nextResponse = DUMP_SIZE_WORD;
			break;
		default:
			// for anything else, nextResponse is still 'first'
			break;
		}
		break;

	case DUMP_SIZE_BYTE: 

		writeBytesToI2C(1);
		nextResponse = DUMP;
		break;

	case DUMP_SIZE_WORD: 

		writeBytesToI2C(2);
		nextResponse = DUMP;
		break;

	case DUMP:




		// TODO
		writeEmptyResponse(); // remove this when DUMP is implemented.




		nextResponse = FIRST;
		break;

	default:


		break;
	}

}

/**
 *	Reads a length input from i2c. Length can be delivered in a byte or a 
 *	big-end word.
 *	@param epectedBytes a pointer to an expectedBytes counter. If the length
 *		is greater than 127, the expecterBytes counter will be incremented.
 *	@return the length value as read from i2c, expressed as a little-end word
 */ 
inline uint16_t readLength(int &expectedBytes) {
	union {
		uint16_t u16;
		uint8_t u8[2];
	};
	u8[1]=(uint8_t)Wire.read();
	if (u8[1] & 0x80) {
		u8[1] &= 0x7f;
		expectedBytes++;
		u8[0] = (uint8_t)Wire.read();
	} else {
		u8[0] = u8[1];
		u8[1] = 0;
	}
	return u16;
}


void i2cCmdHandler(int numBytes) {

	// this is to provide a workspace for receiving bytes
	union {
		uint32_t u32;
		uint16_t u16[2];
		uint8_t u8[4];
	};
	int i;		// general-purpose counter
	uint8_t * ptr;	// general-purpose pointer
	int expectedCmdLength;

	if(numBytes >=2 ) {

		uint8_t command=(uint8_t)Wire.read();
		uint8_t cmdNum=(uint8_t)Wire.read();

		switch (command) {
		case CMD_SYN:

			// make sure there is nothing else in the buffer. Don't ACK invalid SYNs.
			if ( numBytes == 2 ) {
				ack(cmdNum);
			} else {
				rejectBadCmd(cmdNum);
			}
			break;

		case CMD_SETPIXEL_CT:

			// remember this is coming in as a big-end word, but arduino is little-endian.
			expectedCmdLength=3;
			u16[0] = readLength(expectedCmdLength);
			if (numBytes == expectedCmdLength) {
				if (u16[0] * pixelBytes > MAX_PIXEL_BUF) {
					// too long
					rejectOutOfRange(cmdNum);
				} else {
					pixelCt=u16[0];
					ack(cmdNum);
				}
			} else {
				rejectBadCmd(cmdNum);
				break;
			}
			break;

		case CMD_FLASH:
			// TODO
			break;
		case CMD_FLASH_RGN:
			// TODO
			break;
		case CMD_RESUME:
			// TODO
			break;
		case CMD_PIXEL_CLR:

			expectedCmdLength=6;
			u32 = readLength(expectedCmdLength);
			if (numBytes == expectedCmdLength) {
				if (u32 >= pixelCt) {
					rejectOutOfRange(cmdNum);
					break;
				}
			} else {
				rejectBadCmd(cmdNum);
				break; // reject
			}

			// now read the pixel
			u32 *= 3;
			for (i = 0; i < pixelBytes; i++) {				
				pixelsBuf[u32++]=(uint8_t)Wire.read();
			}
			ack(cmdNum);
			break;

		case CMD_PIXEL_RNG:
			break;
		case CMD_PIXEL_BUF:
			break;

		case CMD_DUMP:

			expectedCmdLength=2;
			if (numBytes == expectedCmdLength) {

				if (dumpCursor != dumpStop) {
					// there's a dump in progress. Reject request.
					u8[0] = 0x41;
					u8[1] = cmdNum;
					queueResponse(2, u8);
				}

				// queue the response
				u8[0]=0x7D;
				u8[1]=cmdNum;
				u16[1]=((uint16_t)(pixelCt*pixelBytes));
				if (u16[1]|0xFF00) {
					u8[0]++;
					queueResponse(4, u8);
				} else {
					u16[1] = u16[1] << 8;
					queueResponse(3, u8);
				}

			} else {
				rejectBadCmd(cmdNum);
			}

			break;

		case CMD_DUMP_RNG:
			break;
		case CMD_SEND:

			expectedCmdLength=2;
			if (numBytes != expectedCmdLength) {
				rejectBadCmd(cmdNum);
				break;
			}
			// TODO
			// I don't like this but this is what gets us off the ground quickest.
			// This copies my buffer into a separate buffer for the Neopixel, and
			// then sends that. I want my colour store and the NeoPixel library to
			// work of the same buffer.
			ptr = pixelsBuf;
			for (i = 0; i < pixelCt; i++) {
				leds.setPixelColor(i, *(ptr++), *(ptr++), *(ptr++));
			}
			leds.show();
			ack(cmdNum);

			break;



		default:
			rejectBadCmd(cmdNum);
			break;
		}

	}


}

void setup() {
	leds.begin();
	leds.show();
	leds.setPixelColor(0, 12,8,0);
	leds.show();

	Wire.begin(I2C_CHANNEL);
	Wire.onReceive(i2cCmdHandler);
	Wire.onRequest(i2cResponder);
}

void loop() {
}


