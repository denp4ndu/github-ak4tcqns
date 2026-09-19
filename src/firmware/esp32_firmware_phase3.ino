/*
 * ESP32 IoT Monitor — PHASE 3: TWO-WAY COMMUNICATION & RELAY CONTROL
 * 
 * Hardware Architecture:
 * - ESP32 DevKit V1
 * - GPIO 27: Physical Relay / Actuator Output (active HIGH)
 * - GPIO 34: Analog Sensor (Soil Moisture / ADC V2)
 * - DHT22/DS18B20 on GPIO 4: Temperature Sensor (V1)
 *
 * Protocols:
 * - HTTP POST: Telemetry Sensor Ingestion (/api/device/data) every 5-10s
 * - WebSocket / Socket.IO: Persistent Two-Way Connection for Real-Time Actuator Control
 * 
 * Required Libraries (Arduino Library Manager):
 * 1. ArduinoJson by Benoît Blanchon (v6 or v7)
 * 2. WebSockets by Markus Sattler (includes SocketIOclient.h)
 * 3. WiFi & HTTPClient (Built into ESP32 Arduino Core)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <SocketIOclient.h>

// =================================================================
// 1. NETWORK & CREDENTIALS CONFIGURATION
// =================================================================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Server configuration
const char* SERVER_HOST   = "192.168.1.100"; // Replace with your server IP / domain
const int   SERVER_PORT   = 3000;            // Default Node.js port
const char* HTTP_API_URL  = "http://192.168.1.100:3000/api/device/data";

// Security Token (Generated when adding device in Web Dashboard)
const char* DEVICE_TOKEN  = "esp32_tok_YOUR_DEVICE_TOKEN_HERE";

// Hardware Pin Configuration
const int PIN_RELAY = 27;     // Actuator output: Active HIGH relay / pump
const int PIN_ANALOG_IN = 34; // Analog sensor input (V2)

// =================================================================
// 2. CLIENT INSTANCES & TIMERS
// =================================================================
SocketIOclient socketIO;

unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 5000; // Send sensor telemetry every 5 seconds

// Keep track of current physical actuator state
bool relayState = false;

// =================================================================
// 3. CLOSED-LOOP ACKNOWLEDGEMENT SENDER
// =================================================================
void sendCommandAck(const char* virtualPin, bool state, const char* status) {
  // Construct Socket.IO Event Array: ["command_ack", { payload }]
  DynamicJsonDocument doc(512);
  JsonArray array = doc.to<JsonArray>();
  array.add("command_ack");
  
  JsonObject ackPayload = array.createNestedObject();
  ackPayload["deviceToken"] = DEVICE_TOKEN;
  ackPayload["virtualPin"] = virtualPin;
  ackPayload["value"] = state;
  ackPayload["status"] = status;

  String output;
  serializeJson(doc, output);

  socketIO.sendEVENT(output);
  Serial.printf("[ACK SENT] %s -> Pin: %s, State: %s, Status: %s\n", 
                output.c_str(), virtualPin, state ? "HIGH" : "LOW", status);
}

// =================================================================
// 4. WEBSOCKET EVENT CALLBACK (TWO-WAY DISPATCHER)
// =================================================================
void socketIOEvent(socketIOmessageType_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case sIOtype_DISCONNECT:
      Serial.println("[WS] Disconnected from IoT Monitor Backend.");
      break;

    case sIOtype_CONNECT:
      Serial.println("[WS] Connected to Backend! Joining device room...");
      // In Socket.IO v4, we can emit an explicit ready signal if desired:
      socketIO.send(sIOtype_CONNECT, "/");
      break;

    case sIOtype_EVENT: {
      char* rawMessage = (char*)payload;
      Serial.printf("[WS-IN] Raw Event: %s\n", rawMessage);

      // Socket.IO event payloads arrive formatted as a JSON array:
      // ["device_command", { "virtualPin": "V3", "value": true, "commandId": "..." }]
      DynamicJsonDocument doc(1024);
      DeserializationError err = deserializeJson(doc, rawMessage);
      if (err) {
        Serial.printf("[WS-ERR] JSON Deserialization failed: %s\n", err.c_str());
        return;
      }

      const char* eventName = doc[0];
      if (eventName && strcmp(eventName, "device_command") == 0) {
        JsonObject cmd = doc[1];
        const char* virtualPin = cmd["virtualPin"] | "";
        bool targetValue = cmd["value"] | false;

        Serial.printf("[WS-CMD] Received command for Virtual Pin: %s -> Target Value: %s\n",
                      virtualPin, targetValue ? "TRUE (HIGH)" : "FALSE (LOW)");

        // Route to physical hardware actuator:
        if (strcmp(virtualPin, "V3") == 0 || strcmp(virtualPin, "v3") == 0) {
          // 1. Hardware Action: Execute digitalWrite on GPIO 27
          relayState = targetValue;
          digitalWrite(PIN_RELAY, relayState ? HIGH : LOW);
          
          Serial.printf("[HARDWARE] GPIO %d output set to %s\n", 
                        PIN_RELAY, relayState ? "HIGH" : "LOW");

          // 2. Closed-Loop ACK: Immediately emit command_ack back to Backend
          sendCommandAck("V3", relayState, "SUCCESS");
        } else {
          Serial.printf("[WARN] Unhandled Virtual Pin: %s\n", virtualPin);
          sendCommandAck(virtualPin, targetValue, "FAILED");
        }
      }
      break;
    }

    case sIOtype_ACK:
      Serial.printf("[WS] Received ACK: %u\n", length);
      break;

    case sIOtype_ERROR:
      Serial.printf("[WS-ERR] Socket error code: %u\n", length);
      break;

    default:
      break;
  }
}

// =================================================================
// 5. REST API TELEMETRY SENDER (PHASE 1 & 2 INGESTION)
// =================================================================
void sendTelemetryHttp() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi not connected. Skipping telemetry transmission.");
    return;
  }

  // Read simulated/physical sensors
  int analogValue = analogRead(PIN_ANALOG_IN);
  int soilMoisturePct = map(analogValue, 4095, 0, 0, 100);
  soilMoisturePct = constrain(soilMoisturePct, 0, 100);
  float temperature = 28.5 + (random(-10, 10) / 10.0);

  HTTPClient http;
  http.begin(HTTP_API_URL);
  http.addHeader("Content-Type", "application/json");

  // Format payload according to Phase 1 REST contract:
  // { "deviceToken": "...", "data": { "V0": 65, "V1": 28.4, "V2": 1850, "V3": true } }
  DynamicJsonDocument doc(512);
  doc["deviceToken"] = DEVICE_TOKEN;
  
  JsonObject data = doc.createNestedObject("data");
  data["V0"] = soilMoisturePct;  // Soil Moisture (%)
  data["V1"] = temperature;      // Temperature (°C)
  data["V2"] = analogValue;      // Raw ADC (0-4095)
  data["V3"] = relayState;       // Current Physical Relay Status (true/false)

  String jsonBody;
  serializeJson(doc, jsonBody);

  int httpCode = http.POST(jsonBody);
  if (httpCode > 0) {
    Serial.printf("[HTTP POST] Code: %d, Response: %s\n", httpCode, http.getString().c_str());
  } else {
    Serial.printf("[HTTP POST-ERR] Failed: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

// =================================================================
// 6. SETUP & AUTO-RECONNECT INITIALIZATION
// =================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- ESP32 IoT Monitor: Phase 3 Firmware Booting ---");

  // Configure hardware pins
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, LOW); // Start with Relay OFF
  pinMode(PIN_ANALOG_IN, INPUT);

  // Connect to WiFi
  Serial.printf("[WIFI] Connecting to SSID: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n[WIFI] Connected successfully!");
  Serial.printf("[WIFI] IP Address: %s\n", WiFi.localIP().toString().c_str());

  // Initialize Socket.IO WebSocket Client
  // Handshake URL attaches ?deviceToken=... for secure device authentication
  String socketPath = "/socket.io/?EIO=4&deviceToken=";
  socketPath += DEVICE_TOKEN;

  socketIO.begin(SERVER_HOST, SERVER_PORT, socketPath.c_str());
  socketIO.onEvent(socketIOEvent);
  socketIO.setReconnectInterval(5000); // Auto-reconnect every 5 seconds if disconnected

  Serial.println("[WS] WebSocket Client initialized and connecting...");
}

// =================================================================
// 7. MAIN LOOP (EVENT DRIVEN & PERSISTENT)
// =================================================================
void loop() {
  // Auto-reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] Connection lost. Reconnecting...");
    WiFi.reconnect();
    delay(1000);
    return;
  }

  // Must be called continuously to process incoming WebSocket packets
  socketIO.loop();

  // Periodic Telemetry Transmission (HTTP POST)
  unsigned long now = millis();
  if (now - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = now;
    sendTelemetryHttp();
  }
}
