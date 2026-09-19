import React, { useState } from 'react';
import { FileCode2, Copy, Check, Terminal, ExternalLink, ShieldCheck, Cpu } from 'lucide-react';

export const ApiDocsPage: React.FC = () => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const copyCode = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2500);
  };

  const origin = window.location.origin;

  const postDataCurl = `curl -X POST "${origin}/api/device/data" \\
  -H "Content-Type: application/json" \\
  -d '{
    "deviceToken": "YOUR_DEVICE_TOKEN",
    "data": {
      "V0": 67,
      "V1": 29.5,
      "V2": 1880,
      "V3": true
    }
  }'`;

  const heartbeatCurl = `curl -X POST "${origin}/api/device/heartbeat" \\
  -H "Content-Type: application/json" \\
  -d '{
    "deviceToken": "YOUR_DEVICE_TOKEN"
  }'`;

  const esp32Snippet = `#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* serverUrl = "${origin}/api/device/data";
const char* deviceToken = "YOUR_DEVICE_TOKEN";

void sendSensorData(int soilMoisture, float temp, int rawAdc, bool pump) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["deviceToken"] = deviceToken;
  JsonObject data = doc.createNestedObject("data");
  data["V0"] = soilMoisture; // e.g. 67 %
  data["V1"] = temp;         // e.g. 29.5 °C
  data["V2"] = rawAdc;       // e.g. 1880 ADC
  data["V3"] = pump;         // e.g. true

  String requestBody;
  serializeJson(doc, requestBody);

  int httpCode = http.POST(requestBody);
  if (httpCode == 200) {
    String response = http.getString();
    Serial.println("Telemetry sent: " + response);
  } else {
    Serial.printf("Error POSTing: %d\\n", httpCode);
  }
  http.end();
}`;

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <FileCode2 className="w-5 h-5 text-sky-400" />
          ESP32 REST API Reference & Specification
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Standardized contract for ESP32 microcontroller telemetry ingestion and system integration
        </p>
      </div>

      {/* Endpoint 1: POST /api/device/data */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-md text-xs font-bold font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              POST
            </span>
            <code className="text-sm font-bold text-white font-mono">/api/device/data</code>
          </div>
          <span className="text-xs text-slate-400">Sensor Telemetry Ingestion</span>
        </div>

        <p className="text-xs text-slate-300">
          Main ingestion endpoint for ESP32 microcontrollers. Authenticates via device token, verifies registered Virtual Pins, validates data types and ranges, logs sensor readings to database, and updates device heartbeat.
        </p>

        {/* cURL Example */}
        <div className="relative">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Terminal cURL Example</span>
            <button
              onClick={() => copyCode('data-curl', postDataCurl)}
              className="flex items-center gap-1 text-sky-400 hover:text-sky-300"
            >
              {copiedSection === 'data-curl' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSection === 'data-curl' ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <pre className="bg-slate-950 p-3.5 rounded-xl text-xs font-mono text-slate-200 overflow-x-auto border border-slate-800">
            {postDataCurl}
          </pre>
        </div>

        {/* Error Codes Table */}
        <div>
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
            Possible Status Codes & Error Responses
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-400">
              <thead className="bg-slate-950/60 font-semibold text-slate-300 border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">HTTP Status</th>
                  <th className="py-2 px-3">Error Code</th>
                  <th className="py-2 px-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                <tr>
                  <td className="py-2 px-3 text-emerald-400 font-bold">200 OK</td>
                  <td className="py-2 px-3 text-slate-300">—</td>
                  <td className="py-2 px-3 font-sans text-slate-400">Telemetry ingested successfully and persisted in database</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-rose-400 font-bold">401 Unauthorized</td>
                  <td className="py-2 px-3 text-rose-300">INVALID_DEVICE_TOKEN</td>
                  <td className="py-2 px-3 font-sans text-slate-400">Token missing or SHA-256 hash does not match any registered device</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-amber-400 font-bold">400 Bad Request</td>
                  <td className="py-2 px-3 text-amber-300">UNKNOWN_VIRTUAL_PIN</td>
                  <td className="py-2 px-3 font-sans text-slate-400">Virtual pin sent (e.g. V99) is not registered on this device</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-amber-400 font-bold">400 Bad Request</td>
                  <td className="py-2 px-3 text-amber-300">INVALID_DATA_TYPE</td>
                  <td className="py-2 px-3 font-sans text-slate-400">Data type does not match datastream definition (e.g. string into INTEGER)</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-amber-400 font-bold">400 Bad Request</td>
                  <td className="py-2 px-3 text-amber-300">VALUE_OUT_OF_RANGE</td>
                  <td className="py-2 px-3 font-sans text-slate-400">Reading is below minValue or exceeds maxValue limit</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Endpoint 2: POST /api/device/heartbeat */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-md text-xs font-bold font-mono bg-sky-500/20 text-sky-400 border border-sky-500/30">
              POST
            </span>
            <code className="text-sm font-bold text-white font-mono">/api/device/heartbeat</code>
          </div>
          <span className="text-xs text-slate-400">Device Keep-Alive</span>
        </div>

        <p className="text-xs text-slate-300">
          Updates device connection state without transmitting sensor telemetry. Keeps device marked as ONLINE.
        </p>

        <div className="relative">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Terminal cURL Example</span>
            <button
              onClick={() => copyCode('heartbeat-curl', heartbeatCurl)}
              className="flex items-center gap-1 text-sky-400 hover:text-sky-300"
            >
              {copiedSection === 'heartbeat-curl' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSection === 'heartbeat-curl' ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <pre className="bg-slate-950 p-3.5 rounded-xl text-xs font-mono text-slate-200 overflow-x-auto border border-slate-800">
            {heartbeatCurl}
          </pre>
        </div>
      </div>

      {/* Phase 3: Two-Way WebSocket Specification */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-md text-xs font-bold font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">
              WEBSOCKET
            </span>
            <code className="text-sm font-bold text-white font-mono">Phase 3: Two-Way Control Protocol</code>
          </div>
          <span className="text-xs text-slate-400">Closed-Loop Actuator ACK Flow</span>
        </div>

        <div className="space-y-2 text-xs text-slate-300">
          <p className="font-semibold text-white">Event Lifecycle:</p>
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-[11px] space-y-1.5 text-slate-300">
            <div>1. <span className="text-sky-400">Web Dashboard</span>: Emits <span className="text-amber-300">'send_command'</span> &#123; deviceId, virtualPin: "V3", value: true &#125;</div>
            <div>2. <span className="text-emerald-400">Backend Node.js</span>: Checks IDOR authorization, routes to room_device_&#36;&#123;id&#125;</div>
            <div>3. <span className="text-purple-400">ESP32 Client</span>: Receives <span className="text-amber-300">'device_command'</span>, runs digitalWrite(27, HIGH)</div>
            <div>4. <span className="text-purple-400">ESP32 Client</span>: Emits <span className="text-emerald-300">'command_ack'</span> &#123; deviceToken, virtualPin: "V3", value: true, status: "SUCCESS" &#125;</div>
            <div>5. <span className="text-emerald-400">Backend Node.js</span>: Persists new state into PostgreSQL & emits <span className="text-emerald-300">'state_updated'</span> to Web Dashboard</div>
            <div>6. <span className="text-sky-400">Web Dashboard</span>: Clears loading spinner & updates Toggle Switch state</div>
          </div>
        </div>
      </div>

      {/* ESP32 Arduino C++ Snippet */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-sky-400" />
            <h3 className="text-base font-bold text-white">ESP32 Arduino Firmware (Phase 3 Complete)</h3>
          </div>
          <button
            onClick={() => copyCode('firmware-snippet', esp32Snippet)}
            className="flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs font-medium"
          >
            {copiedSection === 'firmware-snippet' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSection === 'firmware-snippet' ? 'Copied C++' : 'Copy Firmware'}</span>
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Complete production sketch combining HTTP POST sensor telemetry (V0, V1, V2) and Socket.IO WebSocket Client for relay control (GPIO 27 / V3).
          Source file saved in <code className="text-sky-300 font-mono">/src/firmware/esp32_firmware_phase3.ino</code>.
        </p>

        <pre className="bg-slate-950 p-4 rounded-xl text-xs font-mono text-slate-200 overflow-x-auto border border-slate-800 max-h-96">
          {esp32Snippet}
        </pre>
      </div>

    </div>
  );
};
