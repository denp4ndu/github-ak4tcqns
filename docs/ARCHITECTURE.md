# ESP32 IoT Monitor — Architecture (Phase 1)

## 1. System Architecture Diagram

```text
+-------------------------------------------------------------+
|                      PHYSICAL SENSORS                       |
|   Soil Moisture Sensor (AO)        Relay Actuator (State)   |
|         (GPIO 34)                         (GPIO 27)         |
+------------------------------+------------------------------+
                               |
                               v  Analog-to-Digital / Logic
+-------------------------------------------------------------+
|                      ESP32 CONTROLLER                       |
|  - Reads Analog/Digital Inputs                              |
|  - Maps ADC (e.g. 3500-1100) -> Moisture % (0-100)          |
|  - Encapsulates values into Virtual Pins:                   |
|      V0 = 67 (Moisture %)                                   |
|      V1 = 29.5 (Temperature °C)                             |
|      V2 = 1880 (Raw ADC)                                    |
|      V3 = true (Pump status)                                |
|  - Authenticates using cryptographically generated           |
|    Device Token (e.g. Bearer/deviceToken payload)           |
+------------------------------+------------------------------+
                               |
                               v  HTTPS/HTTP POST (JSON)
+-------------------------------------------------------------+
|                       INTERNET / LAN                        |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                     BACKEND REST API                        |
|  (Node.js + Express + TypeScript + Strict Validation Layer)  |
|                                                             |
|  Endpoints:                                                 |
|    * POST /api/device/data                                  |
|    * POST /api/device/heartbeat                             |
|    * POST /api/auth/register & /api/auth/login              |
|    * GET /api/devices/:id/data & /history                   |
|                                                             |
|  Security & Validation Pipeline:                            |
|    1. Verify SHA-256 Token Hash against Device Table        |
|    2. Lookup registered Datastreams for Device              |
|    3. Reject unregistered Virtual Pins (UNKNOWN_VIRTUAL_PIN)|
|    4. Verify Datatype: INTEGER / FLOAT / BOOLEAN / STRING   |
|    5. Verify Min/Max Boundaries (VALUE_OUT_OF_RANGE)        |
|    6. Update device.lastSeen timestamp                      |
|    7. Insert time-series sensor records                     |
+------------------------------+------------------------------+
                               |
                               v  SQL Queries / Transactions
+-------------------------------------------------------------+
|                        DATABASE                             |
|  PostgreSQL / Embedded Relational SQLite                    |
|                                                             |
|  Tables:                                                    |
|    - users (id, email, passwordHash, createdAt)             |
|    - projects (id, userId, name, description)               |
|    - devices (id, projectId, name, tokenHash, lastSeen)     |
|    - datastreams (id, deviceId, virtualPin, dataType, ...)  |
|    - sensor_data (id, deviceId, datastreamId, value, time)  |
+------------------------------+------------------------------+
                               |
                               v  JSON REST Responses
+-------------------------------------------------------------+
|                   WEB DASHBOARD (React + TS)                |
|  - Device Status (ONLINE if lastSeen <= 30s, else OFFLINE)  |
|  - Realtime Last Seen Display                               |
|  - Sensor Value Cards, Gauges, Status Toggles               |
|  - Historical Line Charts (1m, 5m, 1h, 6h, 24h, 7d)        |
|  - "No data received" fallback when sensor hasn't pushed    |
|  - Device & Datastream Management UI                        |
|  - Built-in ESP32 Simulator & Testing Console               |
+-------------------------------------------------------------+
```

## 2. Core Separation of Concerns

### Physical GPIO vs. Virtual Pins
* **Physical GPIO (e.g. GPIO 34)**: The hardware electrical pin connected physically to sensor analog/digital output pins.
* **Virtual Pin (e.g. V0)**: A logical software datastream channel. The ESP32 program reads GPIO 34, calibrates or converts raw signals into engineering units, and transmits the value over `V0`.

### Device Authentication vs. User Authentication
* **User Authentication**: Managed via JWT or session tokens after email/password verification using salted bcrypt hashes. Users can only access projects and devices they own.
* **Device Authentication**: Devices authenticate with a high-entropy secret Device Token generated when the device is registered. The backend stores only the SHA-256 hash of this token (`tokenHash`) to guard against database leaks.
