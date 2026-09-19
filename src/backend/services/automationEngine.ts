import {
  getActiveAutomationRulesByConditionDatastream,
  createNotification,
  prisma,
  ingestTelemetryAtomic,
} from '../db.ts';
import { forwardCommandToDevice, emitNotificationToUser, emitSensorUpdateToUser } from '../sockets/socketManager.ts';
import type { AutomationRule, RuleOperator } from '../types.ts';
import crypto from 'node:crypto';

function compareValues(val: number, operator: RuleOperator, threshold: number): boolean {
  switch (operator) {
    case '>':
      return val > threshold;
    case '<':
      return val < threshold;
    case '>=':
      return val >= threshold;
    case '<=':
      return val <= threshold;
    case '==':
      return val === threshold;
    case '!=':
      return val !== threshold;
    default:
      return false;
  }
}

function normalizeStateValue(val: string | boolean | number): string {
  const s = String(val).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'on') return 'true';
  if (s === 'false' || s === '0' || s === 'off') return 'false';
  return s;
}

export async function processAutomationRulesForReadings(
  deviceId: string,
  userId: string,
  readings: Array<{
    datastreamId: string;
    virtualPin: string;
    value: string;
    numericValue: number | null;
  }>
): Promise<void> {
  for (const reading of readings) {
    const rules = await getActiveAutomationRulesByConditionDatastream(deviceId, reading.datastreamId);
    if (!rules || rules.length === 0) continue;

    const numVal = reading.numericValue !== null ? reading.numericValue : parseFloat(reading.value);

    for (const rule of rules) {
      if (isNaN(numVal)) continue;

      const conditionMet = compareValues(numVal, rule.operator, rule.conditionValue);
      if (!conditionMet) continue;

      // Rule condition is MET. Now check NO-SPAM condition against action datastream current state
      const actionDatastream = await prisma.datastream.findUnique({
        where: { id: rule.actionDatastreamId },
      });

      if (!actionDatastream) continue;

      // Get latest state of action datastream
      const latestReading = await prisma.sensorData.findFirst({
        where: { deviceId, datastreamId: rule.actionDatastreamId },
        orderBy: { timestamp: 'desc' },
      });

      const currentStateNormalized = latestReading ? normalizeStateValue(latestReading.value) : null;
      const targetStateNormalized = normalizeStateValue(rule.actionValue);

      // NO-SPAM VERIFICATION: If state is ALREADY equal to target state, do NOT execute command!
      if (currentStateNormalized === targetStateNormalized) {
        // Already in target state, skip execution
        continue;
      }

      console.log(
        `[AUTOMATION] Rule '${rule.name}' TRIGGERED for device ${deviceId}! Condition: ${reading.virtualPin} (${numVal}) ${rule.operator} ${rule.conditionValue}. Executing action on ${actionDatastream.virtualPin} = ${rule.actionValue}`
      );

      // Determine typed value to send to ESP32
      let valueToSend: boolean | number | string = rule.actionValue;
      if (targetStateNormalized === 'true') valueToSend = true;
      else if (targetStateNormalized === 'false') valueToSend = false;
      else if (!isNaN(Number(rule.actionValue))) valueToSend = Number(rule.actionValue);

      // 1. Send WebSocket command to ESP32
      await forwardCommandToDevice(deviceId, actionDatastream.virtualPin, valueToSend);

      // 2. Persist state update in SensorData so future evaluations and UI reflect the change
      const now = new Date().toISOString();
      const actionReadingValue = String(valueToSend);
      const actionNumericValue = typeof valueToSend === 'boolean' ? (valueToSend ? 1 : 0) : (typeof valueToSend === 'number' ? valueToSend : null);

      await ingestTelemetryAtomic(
        deviceId,
        [
          {
            id: crypto.randomUUID(),
            deviceId,
            datastreamId: actionDatastream.id,
            value: actionReadingValue,
            numericValue: actionNumericValue,
            timestamp: now,
          },
        ],
        now
      );

      // Broadcast sensor_update for action pin to UI
      emitSensorUpdateToUser(userId, {
        deviceId,
        timestamp: now,
        data: {
          [actionDatastream.virtualPin]: actionReadingValue,
        },
      });

      // 3. Create Notification record
      const notifMessage = `Otomasi '${rule.name}' tereksekusi: ${rule.conditionDatastream?.name || reading.virtualPin} (${reading.value}${rule.conditionDatastream?.unit || ''}) ${rule.operator} ${rule.conditionValue} → Perintah ${actionDatastream.name} (${actionDatastream.virtualPin}) = ${rule.actionValue}`;
      const notif = await createNotification(deviceId, 'AUTOMATION_TRIGGERED', notifMessage);

      // 4. Emit new_notification WebSocket event
      emitNotificationToUser(userId, deviceId, notif);
    }
  }
}
