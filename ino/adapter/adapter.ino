
#include <Wire.h>

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
#define RSP_ERR_DUMP_ALREADY_QUEUED	((uint8_t)0x41)
#define RSP_DUMP_RNG_8	((uint8_t)0x7D)
#define RSP_DUMP_RNG_16	((uint8_t)0x7E)

#define RESPONSE_QUEUE_LENGTH 0x10
#define MAX_PIXEL_BUF 0x48

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

void i2cCmdHandler(int numBytes) {

	// this is to provide a workspace for receiving bytes
	union {
		uint32_t u32;
		uint16_t u16[2];
		uint8_t u8[4];
	};
	int i;
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

			expectedCmdLength=3;
			u8[0]=(uint8_t)Wire.read();
			if (u8[0] | 0x80) {
				expectedCmdLength++;
				u16[0] = u8[0] * 0x100 + (uint8_t)Wire.read();
			} else {
				u16[0] = u8[0];
			}
			if (numBytes == expectedCmdLength) {
				// number is u16[0]|0x7ffff -- converted to little-end
				u8[2] = (uint8_t)(u16[0]|0x00ff);
				u8[3] = (uint8_t)(u8[0]|0x7F);
				pixelCt=u16[1];
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

			expectedCmdLength=3;
			u8[0]=(uint8_t)Wire.read();
			if (u8[0] | 0x80) {
				expectedCmdLength++;
				u8[1]=(uint8_t)Wire.read();
			} else {
				u16[0] = u8[0];
			}
			if (numBytes == expectedCmdLength) {
				u32=u16[0]*pixelBytes;
				if (u32 > MAX_PIXEL_BUF) {
					rejectBadCmd(cmdNum);
					break; // reject
				}
			} else {
				rejectBadCmd(cmdNum);
				break; // reject
			}

			// now read the pixel
			for (i = 0; i < pixelBytes; i++) {
				pixelsBuf[u32++]=(uint8_t)Wire.read();
			}
			pixelsBuf[u32]=Wire.read();
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
}


