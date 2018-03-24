
#include <Wire.h>

#define I2C_CHANNEL 0x0B

uint16_t i = 0;

// each command will be size (bytes), command number (uint8_t), and the command itself

void i2cHandler(int numBytes) {
	while(Wire.available()) {
		Serial.print((char)Wire.read());
	}
	Serial.println();
}

void setup() {
	Wire.begin(I2C_CHANNEL);
	Wire.onReceive(i2cHandler);
	Serial.begin(9600);
}

void loop() {
	Serial.print("Hello ");
	Serial.println(++i);
	delay(1000);
}


