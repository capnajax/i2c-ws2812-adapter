
# Pi i²c Adapter for WS2812 "Neopixel™" LEDs

Pi doesn't play nicely with Neopixels -- you don't have fine control over the timing of the pulses you send to the pixels when using multitasking operating systems. With microcontrollers, you do. So I'm putting a microcontroller between the Pi and the LED.

The goal is to make this adapter run on an ATTiny45 and control as many LEDs as possible.

## Challenges

The limiting factor on the number of LEDs I can control is the memory onboard. Each LED requires 3 bytes of RAM, and the chip only has 256 bytes to work with, and I still need room for the program to run. To maximize memory efficiency, I may need to code the LED signalling by hand.

# Interface

The i²c interface messages, as sent to the adapter have one byte for a command number, which cycles every 256 commands, next for a command type, then the rest of the bytes are for parameters. The names provided are for information only.

## Commands

- [0x01 syn](#syn)
- [0x02 setPixelCt](#setpixelct)
- [0x10 flash](#flash)
- [0x11 flashRegion](#flashregion)
- [0x1F resume](#resume)
- [0x20 setPixelColor](#setpixelcolor) - set a single pixel
- [0x21 setPixelRange](#setpixelrange) - set a range of pixels to a single colour
- [0x22 setPixelBuf](#setpixelbuf) - set a range of pixels to a buffer
- [0x7D dumpBuffer](#dumpbuffer)
- [0x7E dumpRange](#dumprange)
- [0x7F send](#send)

## Requests

The i²c master has to request data from the adapter. Every request starts with a request for two bytes. In some cases, the two-byte response will indicate if more data is necessary, then the master must request that much more data. 

The first two-byte response is always a code followed by a command number. The command number is the same as the command that this response is responding to.

### Initial two-byte response:

- [0x00 empty](#empty)
- [0x01 ack](#ack)
- [0x31 errBadCommand](#errbadcommand)
- [0x41 errDumpInProgress](#errdumpinprogress)
- [0x7D,0x7E bufferDump](#bufferdump)

## Command Details

### syn

Essentially a ping -- requests an ACK. No parameters. The adapter will send a response back to the i²c master with 0x02 and the command number.

### setPixelCt

Sets the number of pixels. The parameters are one or two bytes, depending on the pixel count `n`:

| Pixel Ct | Bytes | Notes |
|:---:|:---:| --- |
| `n` ≤ 127 | 1 | Sole byte is the number of pixels |
| 128 ≤ `n` ≤ 21845 | 2 | Add `0x8000` to the number of pixels (i.e. set the first bit to 1) | 

The code provides an address space for up to 21845 RGB LEDs or 16384 RGBW LEDs. The memory limits of the chip will, of course be lower. If there are too many for the chip to handle (limits TBD), it will return an error that includes the limit expressed as a big-end word.

	```0x81 [cmd] [max MSB] [max LSB]```

### flash

Cause all the pixels to set to the same colour without losing the buffer. Can restore the buffer with a `resume`, and `flashRegion` will set pixels not in that region back to their original buffered colour.

### flashRegion

Future feature, uncertain feasibility.

Cause a portion of the LEDs to flash a certain colour. Resets to original colour on `resume` or  another `flash`.

### resume

Returns all pixels to their buffered colour. No parameters necessary.

### setPixelColor

Sets a single pixel to a specific colour. The pixel number can be one (for < 128) or two (set first bit to 1) bytes. 

```[0x20] [cmd] [pixel] [color]```

### setPixelRange

Sets a range of pixels to a specific color. The pixel numbers can be one or two bytes.

```[0x21] [cmd] [pixel 1] [pixel n] [color]```

### setPixelBuf

Sets a range of pixels to buffered colours.

```[0x22] [cmd] [pixel 1] [pixel n] [color 1] [color 2] ... [color n]```

### dumpBuffer

Sends the pixels buffer back through the i²c bus.

### dumpRange

Sends the pixels buffer back through the i²c bus.

### send

Sends the buffer to the pixels. This is a blocking operation and i²c commands will be lost during this process. This sends an ACK back when the `send` is complete.

## Request Response details

### empty

This responds with 0x00 as the first byte, and 0xFF as the second. No follow-on response is necessary.

This indicates that there is nothing to send.

### ack

This responds with 0x01 as the first byte, and a command number as the second byte. No follow-on response is necessary.

### errBadCommand

This responds with 0x41 as the first byte, and a command number as the second byte. No follow-on response is necessary.

This indicates a command was sent that this device does not understand. Note that bad commands are not guaranteed a response.

### errDumpInProgress

This responds with 0x41 as the first byte, and a command number as the second byte. No follow-on response is necessary.

This adapter can only queue one dump at a time. Note the master wouldn't receive this response until the previous dump is complete, so when the master received this response, they can requeue the dump.

### bufferDump

This responds with 0x7D or 0x7E. The next request gets the size of the dump -- 0x7D means only one byte is needed to express the size of the memory dump (in bytes, not pixels), and 0x7E means two bytes are necessary. i.e. if the dump is 255 bytes or less, use 0x7D, and if it's more, use 0x7E.

The first follow-on request is for the buffer size.

Subsequent follow-on requets are for the buffer, 16 bytes at a time, until the dump is exhausted.

For example, if the buffer has the following values in it:
	
	0x00 0x01 0x02 0x03 0x04 0x05 0x06 0x07 0x08 0x09 0x0a 0x0b 0x0c 0x0d 0x0e 0x0f
	0x10 0x11 0x12 0x13 0x14 0x15 0x16 0x17 0x18 0x19 0x1a 0x1b 0x1c 0x1d 0x1e 0x1f
	0x20 0x21 0x22 0x23 0x24 0x25 0x26 0x27 0x28 0x29 0x2a 0x2b 0x2c 0x2d 0x2e 0x2f
	0x30 0x31 0x32 0x33 0x34 0x35 0x36 0x37 0x38 0x39 0x3a 0x3b 0x3c 0x3d 0x3e 0x3f
	0x40 0x41 0x42 0x43 0x44 0x45 0x46 0x47 0x48 0x49 0x4a 0x4b 0x4c 0x4d 0x4e 0x4f
	0x50 0x51 0x52 0x53 0x54 0x55 0x56 0x57 0x58 0x59 0x5a 0x5b 0x5c 0x5d 0x5e 0x5f

And we're requesting pixels 6-22 (zero-indexed, inclusive) RGB pixel (ie 18th-68th byte, zero-indexed, inclusive), this would be the command sequence:

	Command  : 0x7E 0x01 0x05 0x0B // end after the last pixel
	// Request two-byte response
	Response : 0x7D 0x01
	// the 0x7D means I need one byte to express the dump size. Request one more byte
	Response : 0x33 // I'm going to send 51 bytes back
	// Now we're openning a channel for 18 bytes, starting from byte 5*3
	// first request is for the first 16 bytes
	Response : 0x12 0x13 0x14 0x15 0x16 0x17 0x18 0x19 0x1a 0x1b 0x1c 0x1d 0x1e 0x1f 0x20 0x21 
	// request another 16 bytes of the 35 left
	Response : 0x22 0x23 0x24 0x25 0x26 0x27 0x28 0x29 0x2a 0x2b 0x2c 0x2d 0x2e 0x2f 0x30 0x31
	// request another 16 bytes of the 19 left
	Response : 0x32 0x33 0x34 0x35 0x36 0x37 0x38 0x39 0x3a 0x3b 0x3c 0x3d 0x3e 0x3f 0x40 0x41
	// only three bytes left. request them.
	Response : 0x42 0x43 0x44

# Links

- [i2c-bus](https://github.com/fivdi/i2c-bus)

