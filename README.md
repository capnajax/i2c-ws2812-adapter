
# Pi i²c Adapter for WS2812 "Neopixel™" LEDs

Pi doesn't play nicely with Neopixels -- you don't have fine control over the timing of the pulses you send to the pixels when using multitasking operating systems. With microcontrollers, you do. So I'm putting a microcontroller between the Pi and the LED.

The goal is to make this adapter run on an ATTiny45 and control as many LEDs as possible.

Please note that this isn't even Alpha yet. Many features are not yet implemented, and some things still need optimization.

## Challenges

While right now it runs on a standard Arduino Uno, the real goal is to run it on a bare ATtiny45. The limiting factor on the number of LEDs I can control is the memory onboard. Each LED requires 3 bytes of RAM, and the chip only has 256 bytes to work with, and I still need room for the program to run. To maximize memory efficiency, I may need to code the LED signalling by hand.

# Connecting

Right now it runs on an Arduino Uno or compatible. 

Connect the i2c.1 device on the Pi to the i2c on the Arduino, that's Pi Pin 3 to Arduino pin 27 (SDA) and Pi Pin 5 to Arduino pin 28 (SCL). The Arduino will also need power its power and ground connected to the Pi's to ensure the levels are the same. The easiest way to do that is to connect the USB, but this can be accomplished using the appropriate GPIO pins as well.

Connect power and ground from the Arduino to the power and ground pins on the NeoPixel LED, and pin 6 (if this pin is not avaialable, select another with the `0x03 setPin` command) on the Arduino to the `Data IN` pin on the LED. The pins on the LED are, from the flat side, Data out, Ground, +5V, and Data in.

# Interface

The i²c interface messages, as sent to the adapter have one byte for a command number, which cycles every 256 commands, next for a command type, then the rest of the bytes are for parameters. The names provided are for information only; the important part is the number.

## Commands

- [0x01 syn](#0x01-syn)
- [0x02 setPixelCt](#0x02-setpixelct)
- [0x03 setPin](#0x03-setpin)
- [0x10 flash](#0x10-flash)
- [0x11 flashRegion](#0x11-flashregion)
- [0x1F resume](#0x1f-resume)
- [0x20 setPixelColor](#0x20-setpixelcolor) - set a single pixel
- [0x21 setPixelRange](#0x21-setpixelrange) - set a range of pixels to a single colour
- [0x22 setPixelBuf](#0x22-setpixelbuf) - set a range of pixels to a buffer
- [0x7C reset](#0x7c-reset) - restart the driver
- [0x7D dumpBuffer](#0x7d-dumpbuffer) - *not implemented yet*
- [0x7E dumpRange](#0x7e-dumprange) - *not implemented yet*
- [0x7F send](#0x7f-send)

## Requests

The i²c master has to request data from the adapter. Every request starts with a request for two bytes. In some cases, the two-byte response will indicate if more data is necessary, then the master must request that much more data. 

The first two-byte response is always a code followed by a command number. The command number is the same as the command that this response is responding to.

All numbers are in big-end words.

### Initial two-byte response:

- [0x00 empty](#empty)
- [0x01 ack](#ack)
- [0x30 errBadState](#errbadstate)
- [0x31 errBadCommand](#errbadcommand)
- [0x32 errOutOfRange](#erroutofrange)
- [0x33 errOutOfRange](#errnegativerange)
- [0x40 errInternalError](#errinternalerror)
- [0x42 errOverflow](#erroverflow)

## Command Details

### `0x01 syn`

Essentially a ping -- requests an ACK. No parameters. The adapter will send a response back to the i²c master with 0x02 and the command number.

### `0x02 setPixelCt`

Sets the number of pixels. The parameters are one or two bytes, depending on the pixel count `n`:

| Pixel Ct | Bytes | Notes |
|:---:|:---:| --- |
| `n` ≤ 127 | 1 | Sole byte is the number of pixels |
| 128 ≤ `n` ≤ 21845 | 2 | Add `0x8000` to the number of pixels (i.e. set the first bit to 1) | 

```[0x02] [(1)cmd] [(1-2)pixelCt]```

The code provides an address space for up to 21845 RGB LEDs or 16384 RGBW LEDs. The memory limits of the chip will, of course be lower. If there are too many for the chip to handle (limits TBD), it will return an error that includes the limit expressed as a big-end word.

	```0x81 [cmd] [max MSB] [max LSB]```

### `0x03 setPin`

Sets the pin used for the pixels. Accepts one byte, which is the pin number. Does not validate pin number.

```[0x03] [(1)cmd] [(1)pin]```

### `0x10 flash`

Cause all the pixels to set to the same colour without losing the buffer. Can restore the buffer with a `resume`, and `flashRegion` will set pixels not in that region back to their original buffered colour.

```[0x10] [(1)cmd] [(3)color]```

### `0x11 flashRegion`

Future feature, uncertain feasibility.

Cause a portion of the LEDs to flash a certain colour. Resets to original colour on `resume` or  another `flash`.

```[0x11] [(1)cmd] [(1-2)pixel_start] [(1-2)pixel_end] [(3)color]```

### `0x1F resume`

Returns all pixels to their buffered colour. This is used afer a `0x1F flash` command. No parameters necessary.

```[0x1F] [(1)cmd]```

### `0x20 setPixelColor`

Sets a single pixel in the pixel buffer to a specific colour. The pixel number can be one (for < 128) or two (set first bit to 1) bytes. This only sets the pixel in the buffer. Use the `send` command (0x7f) to send the new colour to the led.

```[0x20] [(1)cmd] [(1-2)pixel] [(3)color]```

### `0x21 setPixelRange`

Sets a range of pixels to a specific color. The pixel numbers can be one or two bytes.

```[0x21] [(1)cmd] [(1-2)pixel_start] [(1-2)pixel_end] [(3)color]```

### `0x22 setPixelBuf`

Sets a range of pixels to buffered colours.

```[0x22] [cmd] [(1-2)pixel_start] [(1-2)pixel_end] [(3)color 1] [(3)color 2] ... [(3)color n]```

### `0x7c reset`

Reset the driver

```[0x7c] [(1)cmd]```

### `0x7f send`

Sends the buffer to the pixels. This is a blocking operation and i²c commands will be lost during this process. This sends an ACK back when the `send` is complete.

## Request Response details

All responses will start with the buffer size (one byte) and the number of bytes in the buffer needed to carry the reponse (one byte). So the messages start at third byte. There may be multiple messages in a single response, or none at all.

### empty

This responds with 0x00 as the first byte, and 0xFF as the second. No follow-on response is necessary.

This indicates that there is nothing to send.

### ack

This responds with 0x01 as the first byte, and a command number as the second byte. No follow-on response is necessary.

### errBadState

### errBadCommand

This responds with 0x41 as the first byte, and a command number as the second byte. No follow-on response is necessary.

This indicates a command was sent that this device does not understand. Note that bad commands are not guaranteed a response.

### errOutOfRange

### errNegativeRange

### errInternalError

### errOverflow

The output queue has overflowed and cannot provide a correct response.

## Node Library




# Links

- [i2c-bus](https://github.com/fivdi/i2c-bus)

