/*
  ESP32 IoT Monitor — Firmware Phase 1
  Target: ESP32 -> WiFi -> Internet/LAN -> REST API -> Database -> Web Dashboard

  Hardware Connections:
    - Capacitive / Resistive Soil Sensor AO -> GPIO 34 (Analog In)
    - Relay Module Control IN               -> GPIO 27 (Digital Out)
    - Power: 3.3V / 5V and GND

  Virtual Pin Mapping:
    - V0: Soil Moisture Percentage (0 - 100 %)  [INTEGER]
    - V1: Temperature (simulated/DHT) (°C)      [FLOAT]
    - V2: Raw Soil ADC value (0 - 4095)         [INTEGER]
    - V3: Relay / Pump State (true/false)       [BOOLEAN]

  Libraries Required:
    - WiFi.h (ESP32 Built-in)
    - HTTPClient.h (ESP32 Built-in)
    - ArduinoJson.h (Install via Arduino IDE Library Manager)
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ==========================================
// CONFIGURATION: UPDATE THESE VALUES
// ==========================================
const char* ssid     = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Server API Endpoint (Supports HTTP or HTTPS)
// Example: "http://192.168.1.10:3000/api/device/data" or Cloud Run URL
#define SERVER_URL    "http://YOUR_SERVER_URL/api/device/data"
#define HEARTBEAT_URL "http://YOUR_SERVER_URL/api/device/heartbeat"

// Device Token generated from Web Dashboard (Devices -> Add Device)
#define DEVICE_TOKEN  "YOUR_DEVICE_TOKEN_HERE"

// Hardware Pin Definitions
#define SOIL_PIN      34  // Analog Pin GPIO 34 (Physical ADC)
#define RELAY_PIN     27  // Digital Pin GPIO 27 (Physical Relay)

// Calibration Constants for Soil Moisture Sensor
// Dry air ADC value (~3500) vs Submerged in water ADC value (~1100)
#define ADC_DRY       3500
#define ADC_WET       1100

// Reporting Intervals (in milliseconds)
const unsigned long DATA_INTERVAL      = 5000;   // Send sensor readings every 5 seconds
const unsigned long HEARTBEAT_INTERVAL = 25000;  // Send heartbeat keep-alive every 25 seconds

// State Variables
unsigned long lastDataTime      = 0;
unsigned long lastHeartbeatTime = 0;
int rawADC                      = 0;
int moisturePercent             = 0;
float temperatureC              = 28.5; // Example ambient temperature
bool pumpActive                 = false;

// ==========================================
// FUNCTION DECLARATIONS
// ==========================================
void connectWiFi();
void readSensors();
void printStatus();
bool sendData();
bool sendHeartbeat();

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("==========================================");
  Serial.println("   ESP32 IoT Monitor — PHASE 1 FIRMWARE   ");
  Serial.println("==========================================");

  // Setup GPIOs
  pinMode(SOIL_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Default relay off

  // Connect to Local / Internet WiFi
  connectWiFi();
}

void loop() {
  // Ensure WiFi is still connected
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] Connection lost! Reconnecting...");
    connectWiFi();
  }

  unsigned long currentMillis = millis();

  // Task 1: Periodic Sensor Reading and Data Transmission
  if (currentMillis - lastDataTime >= DATA_INTERVAL) {
    lastDataTime = currentMillis;

    readSensors();
    printStatus();
    sendData();
  }

  // Task 2: Periodic Heartbeat (ensures lastSeen is updated even without data changes)
  if (currentMillis - lastHeartbeatTime >= HEARTBEAT_INTERVAL) {
    lastHeartbeatTime = currentMillis;
    sendHeartbeat();
  }

  delay(50); // Yield to ESP32 RTOS background watchdog
}

// ==========================================
// IMPLEMENTATION
// ==========================================

void connectWiFi() {
  Serial.printf("[WIFI] Connecting to SSID: %s\n", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected successfully!");
    Serial.print("[WIFI] Local IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("[WIFI] Signal Strength (RSSI): ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("\n[WIFI] Failed to connect! Check credentials and router.");
  }
}

void readSensors() {
  // 1. Read Physical GPIO 34 (Analog ADC: 0 - 4095)
  // Take average of 5 consecutive readings for noise reduction
  long sum = 0;
  for (int i = 0; i < 5; i++) {
    sum += analogRead(SOIL_PIN);
    delay(10);
  }
  rawADC = sum / 5;

  // 2. Map ADC reading to Soil Moisture Percentage (0% - 100%)
  // Note: Higher ADC usually means drier soil (higher resistance)
  long mappedValue = map(rawADC, ADC_DRY, ADC_WET, 0, 100);

  // 3. Constrain within valid physical boundaries
  moisturePercent = constrain(mappedValue, 0, 100);

  // Simple automated relay threshold logic (optional local fail-safe)
  if (moisturePercent < 20) {
    // Soil is very dry -> trigger pump
    pumpActive = true;
    digitalWrite(RELAY_PIN, HIGH);
  } else if (moisturePercent > 60) {
    pumpActive = false;
    digitalWrite(RELAY_PIN, LOW);
  }
}

void printStatus() {
  Serial.println("------------------------------------------");
  Serial.printf("[SENSOR] Physical GPIO 34 ADC : %d\n", rawADC);
  Serial.printf("[SENSOR] Soil Moisture (V0)    : %d %%\n", moisturePercent);
  Serial.printf("[SENSOR] Temperature (V1)      : %.1f °C\n", temperatureC);
  Serial.printf("[SENSOR] Pump Relay (V3)       : %s\n", pumpActive ? "ON" : "OFF");
}

bool sendData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Cannot send data: WiFi disconnected");
    return false;
  }

  HTTPClient http;
  Serial.print("[HTTP] Sending POST to: ");
  Serial.println(SERVER_URL);

  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  // Construct JSON Payload using ArduinoJson
  // Matches backend API contract:
  // {
  //   "deviceToken": "...",
  //   "data": { "V0": 67, "V1": 28.5, "V2": 1880, "V3": true }
  // }
  StaticJsonDocument<256> doc;
  doc["deviceToken"] = DEVICE_TOKEN;

  JsonObject dataObj = doc.createNestedObject("data");
  dataObj["V0"] = moisturePercent;    // Datastream V0 (INTEGER, 0-100)
  dataObj["V1"] = temperatureC;       // Datastream V1 (FLOAT, 0-100)
  dataObj["V2"] = rawADC;             // Datastream V2 (INTEGER, 0-4095)
  dataObj["V3"] = pumpActive;         // Datastream V3 (BOOLEAN, true/false)

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  int httpResponseCode = http.POST(jsonPayload);

  if (httpResponseCode > 0) {
    String responseString = http.getString();
    Serial.printf("[HTTP] Response Status: %d\n", httpResponseCode);
    Serial.print("[HTTP] Server Response: ");
    Serial.println(responseString);

    if (httpResponseCode == 200) {
      Serial.println("[SERVER] DATA RECEIVED & STORED");
      http.end();
      return true;
    } else if (httpResponseCode == 401) {
      Serial.println("[SERVER ERROR] 401 INVALID_DEVICE_TOKEN - Check your token in Web Dashboard!");
    } else if (httpResponseCode == 400) {
      Serial.println("[SERVER ERROR] 400 VALIDATION FAILED - Check virtual pins and datatypes!");
    }
  } else {
    Serial.printf("[HTTP] Connection failed, error: %s\n", http.errorToString(httpResponseCode).c_str());
  }

  http.end();
  return false;
}

bool sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.begin(HEARTBEAT_URL);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<128> doc;
  doc["deviceToken"] = DEVICE_TOKEN;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  int httpCode = http.POST(jsonPayload);
  if (httpCode == 200) {
    Serial.println("[HEARTBEAT] Keep-alive OK (Status: ONLINE)");
    http.end();
    return true;
  }
  http.end();
  return false;
}
