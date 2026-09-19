# ESP32 Setup & Wiring Guide

## 1. Hardware Connections

| Sensor / Actuator | ESP32 Pin | Note |
| :--- | :--- | :--- |
| **Capacitive/Resistive Soil Moisture Sensor AO** | **GPIO 34** (ADC1_CH6) | Input-only analog pin (0 - 4095 ADC) |
| **Relay Module IN** | **GPIO 27** | Output pin for water pump control |
| **VCC (Sensors)** | **3.3V or 5V** | Depending on sensor module |
| **GND** | **GND** | Common ground |

> **IMPORTANT ARCHITECTURAL RULE**:
> GPIO 34 is the physical hardware pin. **V0** is the logical Virtual Pin.
> GPIO 27 is the physical relay pin. **V3** is the logical Virtual Pin.
> The firmware converts the raw ADC from GPIO 34 into calibrated moisture % and maps it to Virtual Pin V0.

---

## 2. Arduino IDE Setup

1. Install Arduino IDE (v2.0 or newer recommended).
2. Add ESP32 board package via Board Manager:
   * URL: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   * Search for `esp32` by Espressif Systems and install.
3. Install Library via Library Manager:
   * `ArduinoJson` by Benoit Blanchon (version 6 or 7).
4. Select Board: `ESP32 Dev Module`.
5. Open `/esp32-example/esp32_iot_monitor.ino`.
6. Update configuration:
   ```cpp
   const char* ssid = "YOUR_WIFI_SSID";
   const char* password = "YOUR_WIFI_PASSWORD";
   #define SERVER_URL "https://YOUR_APP_URL/api/device/data"
   #define HEARTBEAT_URL "https://YOUR_APP_URL/api/device/heartbeat"
   #define DEVICE_TOKEN "PASTE_YOUR_DEVICE_TOKEN_FROM_DASHBOARD"
   ```
7. Click **Upload**, then open **Serial Monitor** (Baud: 115200).
