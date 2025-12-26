# Zarduino: BLE Arduino Car Controller

This project provides a complete system to control an Arduino-powered car via a web browser using Bluetooth Low Energy (BLE). It utilizes an ESP32 as a bridge between the web interface and an Arduino motor controller.

---

##  System Architecture

1.  Web App: Sends commands ('f', 'b', 'l', 'r', 's') over BLE using the Web Bluetooth API.
2.  ESP32 Bridge: Receives BLE data and forwards it via Serial (UART) to the Arduino.
3.  Arduino Car: Receives Serial data to drive two DC motors and a steering servo.

---

##  Features

* Dual Control Modes: Toggle between a manual button UI and Xbox Gamepad/Joystick support.
* Modern Web UI: Features a dark mode toggle and real-time connection status updates.
* Optimized Performance: Uses a deadzone for joysticks to prevent accidental movement.
* Responsive Feedback: Informs the user when the ESP32 or Gamepad is connected/disconnected.

---

##  Hardware Setup

### Wiring Diagram
* ESP32 to Arduino: GPIO 17 (TX) -> Arduino Pin 12 (RX).
* Steering Servo: Connected to Arduino Pin 8.
* Left Motor: Driven by Arduino Pins 3 and 11.
* Right Motor: Driven by Arduino Pins 5 and 6.

### Bluetooth Configuration
* Service UUID: 4fafc201-1fb5-459e-8fcc-c5c9c331914b.
* Characteristic UUID: beb5483e-36e1-4688-b7f5-ea07361b26a8.
* Device Name: "Arduino-BLE-Bridge".

---

##  Software Components

### 1. Arduino Firmware (car_controller.ino)
Handles physical movement. It listens for single characters at 9600 baud:
* 'f': Move Forward.
* 'b': Move Backward.
* 'l': Turn Left (Servo to 45 degrees).
* 'r': Turn Right (Servo to 105 degrees).
* 's': Stop (Motors off, Servo to 75 degrees).

### 2. ESP32 Bridge Firmware (ble_bridge.ino)
Acts as the BLE Server. It receives strings from the Web App and prints them to the HardwareSerial port connected to the Arduino.

### 3. Web App (index.html)
The user interface. Requires a BLE-capable browser and an HTTPS/Localhost environment to access the Web Bluetooth API.

---

##  How to Use

1.  Power On: Turn on the Car (Arduino + ESP32).
2.  Connect: Open index.html, click "Connect to BLE", and select "Arduino-BLE-Bridge".
3.  Drive:
    * Manual: Use the on-screen arrows.
    * Joystick: Click "Switch to Joystick Mode" and use the left stick of an Xbox Controller.

---

##  Configuration
* Servo Trim: Modify 'initAngle' in the Arduino code to center your steering.
* Turn Intensity: Adjust 'Rmax' and 'Lmin' (currently +/- 30 degrees) for wider or tighter turns.
