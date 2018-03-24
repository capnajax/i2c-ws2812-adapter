
# Pi I²C Adapter for WS2812 "Neopixel™" LEDs

Pi doesn't play nicely with Neopixels -- you don't have fine control over the timing of the pulses you send to the pixels when using multitasking operating systems. With microcontrollers, you do. So I'm putting a microcontroller between the Pi and the LED.

The goal is to make this adapter run on an ATTiny45 and control as many LEDs as possible.

## Challenges

The limiting factor on the number of LEDs I can control is the memory onboard. Each LED requires 3 bytes of RAM, and the chip only has 256 bytes to work with, and I still need room for the program to run. To maximize memory efficiency, I may need to code the LED signalling by hand.



# Interface

The I²C interface messages, as sent to the adapter have one byte for a command number, which cycles every 256 commands, next for a command type, then the rest of the bytes are for parameters. The names provided are for information only.

- [0x01 syn](#syn)
- [0x02 setPixelCt](#setpixelct)
- [0x10 flash](#flash)
- [0x11 flashRegion](#flashregion)
- [0x1F resume](#resume)
- [0x20 setPixelColor](#setpixelcolor)
- [0x21 setPixelsColor](#setpixelscolor)
- [0x7F send](#send)

### syn

Essentially a ping -- requests an ACK. No parameters. The adapter will send a response back to the I²C master with 0x02 and the command number.

### setPixelCt

Sets the number of pixels. The parameters are one or two bytes, depending on the pixel count `n`:
| Pixel Ct | Bytes | Notes |
| --- | --- | --- |
| n < 128 | 1 | Sole byte is the number of pixels |
| 128 ≤ n < 32768 | 2 | Add 0x8000 to the number of pixels (i.e. set the first bit to 1) | 

If there are too many for the chip to handle (limits TBD), it will return an error that includes the limit expressed as a big-end word.
	```0x81 [cmd] [max MSB] [max LSB]```

### flash

Cause all the pixels to set to the same colour without losing the buffer. Can restore the buffer with a `resume`, and `flashRegion` will set pixels not in that region back to their original buffered colour.

### flashRegion

Future feature, uncertain feasibility.

Cause a portion of the LEDs to flash a certain colour. Resets to original colour on `resume` or  another `flash`.

### resume

Returns all pixels to their buffered colour. No parameters necessary.

### setPixelColor
### setPixelsColor
### send



