# ESP32 IoT Monitor — API Specification (Phase 1)

All request and response bodies use JSON (`Content-Type: application/json`).

---

## 1. Authentication Endpoints (User)

### `POST /api/auth/register`
Creates a new user account.
* **Headers**: `Content-Type: application/json`
* **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "SecurePassword123"
  }
  ```
* **Success Response (201 Created)**:
  ```json
  {
    "success": true,
    "token": "eyJhbGciOi...",
    "user": {
      "id": "uuid-here",
      "email": "user@example.com"
    }
  }
  ```
* **Error Response (400 Bad Request)**:
  ```json
  {
    "success": false,
    "error": "EMAIL_ALREADY_EXISTS"
  }
  ```

---

### `POST /api/auth/login`
Authenticates a user and issues a JWT token.
* **Headers**: `Content-Type: application/json`
* **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "SecurePassword123"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "token": "eyJhbGciOi...",
    "user": {
      "id": "uuid-here",
      "email": "user@example.com"
    }
  }
  ```
* **Error Response (401 Unauthorized)**:
  ```json
  {
    "success": false,
    "error": "INVALID_CREDENTIALS"
  }
  ```

---

## 2. Project Management

### `GET /api/projects`
List all projects for the authenticated user.
* **Headers**: `Authorization: Bearer <JWT_TOKEN>`
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "projects": [
      {
        "id": "project-uuid",
        "name": "Smart Irrigation",
        "description": "Greenhouse automation",
        "deviceCount": 1,
        "createdAt": "2026-09-18T06:00:00.000Z"
      }
    ]
  }
  ```

### `POST /api/projects`
Create a new project.
* **Headers**: `Authorization: Bearer <JWT_TOKEN>`
* **Request**:
  ```json
  {
    "name": "Smart Irrigation",
    "description": "Greenhouse project"
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "success": true,
    "project": {
      "id": "project-uuid",
      "name": "Smart Irrigation",
      "description": "Greenhouse project"
    }
  }
  ```

---

## 3. Device Management

### `GET /api/devices`
List devices for the user (can filter by `?projectId=...`).
* **Headers**: `Authorization: Bearer <JWT_TOKEN>`
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "devices": [
      {
        "id": "device-uuid",
        "projectId": "project-uuid",
        "projectName": "Smart Irrigation",
        "name": "ESP32 Greenhouse 01",
        "deviceIdentifier": "ESP32-001",
        "status": "ONLINE",
        "lastSeen": "2026-09-18T06:00:00.000Z",
        "datastreamCount": 4
      }
    ]
  }
  ```

### `POST /api/devices`
Register a new device. Generates a secure Device Token.
* **Headers**: `Authorization: Bearer <JWT_TOKEN>`
* **Request**:
  ```json
  {
    "projectId": "project-uuid",
    "name": "ESP32 Greenhouse 01",
    "deviceIdentifier": "ESP32-001"
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "success": true,
    "device": {
      "id": "device-uuid",
      "name": "ESP32 Greenhouse 01",
      "deviceIdentifier": "ESP32-001",
      "status": "OFFLINE",
      "lastSeen": null
    },
    "deviceToken": "esp32_tok_9f81a7b3d2c1..."
  }
  ```
*(Note: `deviceToken` is only revealed upon creation or regeneration)*.

### `POST /api/devices/:id/regenerate-token`
Regenerates the device token and invalidates the previous one.
* **Headers**: `Authorization: Bearer <JWT_TOKEN>`
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "deviceToken": "esp32_tok_new_token_here...",
    "message": "Token regenerated successfully. Update your ESP32 firmware."
  }
  ```

---

## 4. Datastream Management

### `GET /api/devices/:id/datastreams`
List all datastreams defined on this device.

### `POST /api/devices/:id/datastreams`
Create a new datastream.
* **Request**:
  ```json
  {
    "virtualPin": "V0",
    "name": "Kelembaban Tanah",
    "dataType": "INTEGER",
    "unit": "%",
    "minValue": 0,
    "maxValue": 100,
    "description": "Soil moisture percentage"
  }
  ```

---

## 5. ESP32 Device Ingestion API (Hardware Integration)

### `POST /api/device/data`
Send sensor readings from ESP32 to Backend.
* **Authentication**: Token passed in JSON `deviceToken` or `X-Device-Token` header.
* **Request**:
  ```json
  {
    "deviceToken": "esp32_tok_9f81a7b3d2c1...",
    "data": {
      "V0": 67,
      "V1": 29.5,
      "V2": 1880,
      "V3": true
    }
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Data received",
    "deviceId": "ESP32-001",
    "received": {
      "V0": 67,
      "V1": 29.5,
      "V2": 1880,
      "V3": true
    }
  }
  ```
* **Error: Invalid Token (401 Unauthorized)**:
  ```json
  {
    "success": false,
    "error": "INVALID_DEVICE_TOKEN"
  }
  ```
* **Error: Unregistered Pin (400 Bad Request)**:
  ```json
  {
    "success": false,
    "error": "UNKNOWN_VIRTUAL_PIN",
    "details": "Virtual Pin V99 is not registered on this device"
  }
  ```
* **Error: Invalid Data Type (400 Bad Request)**:
  ```json
  {
    "success": false,
    "error": "INVALID_DATA_TYPE",
    "details": "Value 'hello' is invalid for datastream V0 (expected INTEGER)"
  }
  ```
* **Error: Out of Range (400 Bad Request)**:
  ```json
  {
    "success": false,
    "error": "VALUE_OUT_OF_RANGE",
    "details": "Value 150 is out of range for V0 (allowed 0 to 100)"
  }
  ```

---

### `POST /api/device/heartbeat`
Device periodic keep-alive without sensor data.
* **Request**:
  ```json
  {
    "deviceToken": "esp32_tok_9f81a7b3d2c1..."
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "status": "ONLINE",
    "serverTime": "2026-09-18T06:00:00.000Z"
  }
  ```

---

## 6. Dashboard & Historical Data

### `GET /api/devices/:id/data`
Get current live state of all datastreams for a device.
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "device": {
      "id": "device-uuid",
      "name": "ESP32 Greenhouse 01",
      "status": "ONLINE",
      "lastSeen": "2026-09-18T06:00:00.000Z"
    },
    "datastreams": [
      {
        "id": "stream-1",
        "virtualPin": "V0",
        "name": "Kelembaban Tanah",
        "dataType": "INTEGER",
        "unit": "%",
        "currentValue": 67,
        "lastUpdated": "2026-09-18T06:00:00.000Z"
      }
    ]
  }
  ```

### `GET /api/devices/:id/data/history?datastream=V0&range=1h`
Query historical points for graphs.
* **Query Parameters**:
  * `datastream`: Virtual Pin (`V0`, `V1`, etc.)
  * `range`: `1m`, `5m`, `1h`, `6h`, `24h`, `7d`
* **Response (200 OK)**:
  ```json
  {
    "success": true,
    "virtualPin": "V0",
    "range": "1h",
    "points": [
      {
        "timestamp": "2026-09-18T05:55:00.000Z",
        "value": 65
      },
      {
        "timestamp": "2026-09-18T06:00:00.000Z",
        "value": 67
      }
    ]
  }
  ```
