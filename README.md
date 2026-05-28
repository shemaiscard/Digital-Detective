# Zarduino — BLE Arduino Car Controller

A complete system to control an Arduino-powered car via a web browser using **Bluetooth Low Energy (BLE)**. Uses an ESP32 as a bridge between the web interface and an Arduino motor controller.

## System Architecture

1. **Web App** — Sends commands (`f`, `b`, `l`, `r`, `s`) over BLE via the Web Bluetooth API
2. **ESP32 Bridge** — Receives BLE data and forwards it via Serial (UART) to the Arduino
3. **Arduino Car** — Receives serial data to drive two DC motors and a steering servo

## Features

- Dual control modes: on-screen buttons or Xbox gamepad/joystick
- Dark mode toggle and real-time BLE connection status
- Joystick deadzone to prevent accidental movement
- Responsive feedback for connection/disconnection events

## Hardware Wiring

| Connection | Detail |
|---|---|
| ESP32 → Arduino | GPIO 17 (TX) → Arduino Pin 12 (RX) |
| Steering Servo | Arduino Pin 8 |
| Left Motor | Arduino Pins 3 and 11 |
| Right Motor | Arduino Pins 5 and 6 |

**BLE Configuration:**
- Service UUID: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
- Characteristic UUID: `beb5483e-36e1-4688-b7f5-ea07361b26a8`
- Device Name: `Arduino-BLE-Bridge`

## Software Components

| File | Purpose |
|---|---|
| `car_controller.ino` | Arduino firmware — handles motor and servo movement |
| `ble_bridge.ino` | ESP32 BLE server — receives and relays commands |
| `index.html` | Web controller UI |

**Command map:** `f` forward · `b` backward · `l` turn left · `r` turn right · `s` stop

## How to Use

1. Power on the car (Arduino + ESP32)
2. Open `index.html` on a BLE-capable browser (Chrome recommended, HTTPS or localhost required)
3. Click "Connect to BLE" and select `Arduino-BLE-Bridge`
4. Drive with on-screen arrows or an Xbox controller

## Configuration

- **Servo trim**: Modify `initAngle` in the Arduino code to center steering
- **Turn range**: Adjust `Rmax` / `Lmin` (default ±30°)
