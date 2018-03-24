
# Pi I²C Adapter for WS2812 "Neopixel™" LEDs

Pi doesn't play nicely with Neopixels -- you don't have fine control over the timing of the pulses you send to the pixels when using multitasking operating systems. With microcontrollers, you do. So I'm putting a microcontroller between the Pi and the LED.

The goal is to make this adapter run on an ATTiny45 and control as many LEDs as possible.

## Challenges

The limiting factor on the number of LEDs I can control is the memory onboard. Each LED requires 3 bytes of RAM, and the chip only has 256 bytes to work with, and I still need room for the program to run. To maximize memory efficiency, I may need to code the LED signalling by hand.



