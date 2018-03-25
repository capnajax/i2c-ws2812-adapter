
#include <Wire.h>

#define I2C_CHANNEL 0x0B

#define CMD_SYN 		0x01
#define CMD_SETPIXEL_CT	0x02
#define CMD_FLASH 		0x10
#define CMD_FLASH_RGN 	0x11
#define CMD_RESUME		0x1F
#define CMD_PIXEL_CLR	0x20
#define CMD_PIXEL_RNG	0x21
#define CMD_PIXEL_BUF 	0x22
#define CMD_DUMP		0x7E
#define CMD_SEND		0x7F

#define RESPONSE_QUEUE_LENGTH 0x10
#define MAX_PIXEL_BUF 0x17
#define PIXEL_BYTES 3

uint8_t pixelsBuf[MAX_PIXEL_BUF*PIXEL_BYTES];
uint8_t responseQueue[RESPONSE_QUEUE_LENGTH];
uint8_t responseQueueReadOffset=0;
uint8_t responseQueueWriteOffset=0;

uint16_t i = 0;
uint16_t pixelCt = 1;


void queueResponse(int len, uint8_t * bytes) {
	int i;
	// first find a spot we can write that data in the queue. Return if there is no space.
	if (responseQueueWriteOffset > responseQueueReadOffset) {
		// write is still ahead of read. Let's see if there's room at the end.
		if (responseQueueWriteOffset + len > RESPONSE_QUEUE_LENGTH) {
			// there isn't enough room at the end. Maybe I can split it?
			if ((responseQueueWriteOffset + len) - RESPONSE_QUEUE_LENGTH > responseQueueReadOffset) {
				// ok, this is an overflow for sure. Let's not queue this one.
				return;
			}
		} 
	} else if (responseQueueWriteOffset == responseQueueReadOffset) {
		// read has caught up to write.
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
		responseQueueWriteOffset = (++responseQueueWriteOffset)%RESPONSE_QUEUE_LENGTH;
		responseQueue[responseQueueWriteOffset] = bytes[i];
	}
}

// each command will be size (bytes), command number (uint8_t), and the command itself

void ack(uint8_t cmdNum) {
	queueResponse(2, [0x02, cmdNum]);
}

void i2cResponder() {
	// for the most part, we're going to assume each command is two bytes
}

void i2cCmdHandler(int numBytes) {

	// this is to provide a workspace for receiving bytes
	union {
		uint32_t u32;
		uint16_t u16[2];
		uint8_t u8[4]
	}
	uint8_t workspace[4]; // space to use for receiving data
	int i;
	int expectedCmdLength;

	if(numBytes >=2 ) {

		uint8_t command=(uint8_t)Wire.read();
		uint8_t cmdNum=(uint8_t)Wire.read();

		switch (Wire.read()) {
		case CMD_SYN:

			// make sure there is nothing else in the buffer. Don't ACK invalid SYNs.
			if ( numBytes == 2 ) {
				ack(cmdNum);
			}
			break;

		case CMD_SETPIXEL_CT:

			expectedCmdLength=3
			u8[0]=(uint8_t)Wire.read();
			if (u8[0] | 0x80) {
				expectedCmdLength++;
				u8[1]=(uint8_t)Wire.read();
			} else {
				u16[0] = u8[0];
			}
			if (numBytes == expectedCmdLength) {
				pixelCt=u16[0]|0x7fff;
			} else {
				// reject command
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

			expectedCmdLength=3
			u8[0]=(uint8_t)Wire.read();
			if (u8[0] | 0x80) {
				expectedCmdLength++;
				u8[1]=(uint8_t)Wire.read();
			} else {
				u16[0] = u8[0];
			}
			if (numBytes == expectedCmdLength) {
				u32=u16[0]*PIXEL_BYTES;
				if (u32 > MAX_PIXEL_BUF) {
					break; // reject
				}
			} else {
				break; // reject
			}

			// now read the pixel
			for (i = 0; i < PIXEL_BYTES; i++) {
				pixelsBuf[u32++]=(uint8_t)Wire.read();
			}
			pixelsBuf[u32]=Wire.read();
			break;

		case CMD_PIXEL_RNG:
			break;
		case CMD_PIXEL_BUF:
			break;
		case CMD_DUMP:
			break;
		case CMD_SEND:
			break;
		default:
			break;
		}

	}


}

void setup() {
	Wire.begin(I2C_CHANNEL);
	Wire.onReceive(i2cCmdHandler);
	Wire.onRequest(i2cResponder);
	Serial.begin(9600);
}

void loop() {
	Serial.print("Hello ");
	Serial.println(++i);
	delay(1000);
}


