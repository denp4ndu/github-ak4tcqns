import {
  getDeviceByTokenHash,
  getDatastreamsByDeviceId,
  insertSensorData,
  updateDeviceLastSeen,
  getHistoricalData,
} from '../db.ts';
import { hashDeviceToken } from '../auth.ts';
import { ErrorCode, type DataType, type Datastream, type Device } from '../types.ts';

export const DEVICE_TIMEOUT_SECONDS = Number(process.env.DEVICE_TIMEOUT_SECONDS || 30);

export interface ValidationResult {
  valid: boolean;
  errorCode?: ErrorCode;
  errorMessage?: string;
  normalizedValue?: string;
  numericValue?: number | null;
}

export function computeDeviceStatus(lastSeen: string | null): {
  status: 'ONLINE' | 'OFFLINE';
  secondsSinceLastSeen: number | null;
} {
  if (!lastSeen) {
    return { status: 'OFFLINE', secondsSinceLastSeen: null };
  }

  const lastSeenMs = new Date(lastSeen).getTime();
  const nowMs = Date.now();
  const diffSeconds = Math.max(0, Math.floor((nowMs - lastSeenMs) / 1000));

  if (diffSeconds <= DEVICE_TIMEOUT_SECONDS) {
    return { status: 'ONLINE', secondsSinceLastSeen: diffSeconds };
  } else {
    return { status: 'OFFLINE', secondsSinceLastSeen: diffSeconds };
  }
}

export function validateDatastreamValue(datastream: Datastream, rawVal: unknown): ValidationResult {
  if (rawVal === undefined || rawVal === null) {
    return {
      valid: false,
      errorCode: ErrorCode.VALIDATION_ERROR,
      errorMessage: `Value cannot be null for datastream ${datastream.virtualPin}`,
    };
  }

  let normalizedValue = '';
  let numericValue: number | null = null;

  switch (datastream.dataType) {
    case 'INTEGER': {
      // Check if pure integer (either number or pure integer string)
      let parsedNum: number;
      if (typeof rawVal === 'number') {
        if (!Number.isInteger(rawVal)) {
          return {
            valid: false,
            errorCode: ErrorCode.INVALID_DATA_TYPE,
            errorMessage: `Value ${rawVal} is a floating point number, expected INTEGER for ${datastream.virtualPin}`,
          };
        }
        parsedNum = rawVal;
      } else if (typeof rawVal === 'string' && /^-?\d+$/.test(rawVal.trim())) {
        parsedNum = parseInt(rawVal.trim(), 10);
      } else {
        return {
          valid: false,
          errorCode: ErrorCode.INVALID_DATA_TYPE,
          errorMessage: `Value '${String(rawVal)}' is invalid for datastream ${datastream.virtualPin} (expected INTEGER)`,
        };
      }

      // Range validation
      if (datastream.minValue !== null && parsedNum < datastream.minValue) {
        return {
          valid: false,
          errorCode: ErrorCode.VALUE_OUT_OF_RANGE,
          errorMessage: `Value ${parsedNum} is below minimum allowed value (${datastream.minValue}) for ${datastream.virtualPin}`,
        };
      }
      if (datastream.maxValue !== null && parsedNum > datastream.maxValue) {
        return {
          valid: false,
          errorCode: ErrorCode.VALUE_OUT_OF_RANGE,
          errorMessage: `Value ${parsedNum} exceeds maximum allowed value (${datastream.maxValue}) for ${datastream.virtualPin}`,
        };
      }

      normalizedValue = parsedNum.toString();
      numericValue = parsedNum;
      break;
    }

    case 'FLOAT': {
      let parsedNum: number;
      if (typeof rawVal === 'number') {
        if (isNaN(rawVal) || !isFinite(rawVal)) {
          return {
            valid: false,
            errorCode: ErrorCode.INVALID_DATA_TYPE,
            errorMessage: `Value is not a valid number for ${datastream.virtualPin}`,
          };
        }
        parsedNum = rawVal;
      } else if (typeof rawVal === 'string' && !isNaN(Number(rawVal.trim()))) {
        parsedNum = parseFloat(rawVal.trim());
      } else {
        return {
          valid: false,
          errorCode: ErrorCode.INVALID_DATA_TYPE,
          errorMessage: `Value '${String(rawVal)}' is invalid for datastream ${datastream.virtualPin} (expected FLOAT)`,
        };
      }

      // Range validation
      if (datastream.minValue !== null && parsedNum < datastream.minValue) {
        return {
          valid: false,
          errorCode: ErrorCode.VALUE_OUT_OF_RANGE,
          errorMessage: `Value ${parsedNum} is below minimum allowed value (${datastream.minValue}) for ${datastream.virtualPin}`,
        };
      }
      if (datastream.maxValue !== null && parsedNum > datastream.maxValue) {
        return {
          valid: false,
          errorCode: ErrorCode.VALUE_OUT_OF_RANGE,
          errorMessage: `Value ${parsedNum} exceeds maximum allowed value (${datastream.maxValue}) for ${datastream.virtualPin}`,
        };
      }

      normalizedValue = parsedNum.toString();
      numericValue = parsedNum;
      break;
    }

    case 'BOOLEAN': {
      let boolVal: boolean;
      if (typeof rawVal === 'boolean') {
        boolVal = rawVal;
      } else if (rawVal === 1 || rawVal === '1' || rawVal === 'true' || rawVal === 'TRUE' || rawVal === 'ON' || rawVal === 'on') {
        boolVal = true;
      } else if (rawVal === 0 || rawVal === '0' || rawVal === 'false' || rawVal === 'FALSE' || rawVal === 'OFF' || rawVal === 'off') {
        boolVal = false;
      } else {
        return {
          valid: false,
          errorCode: ErrorCode.INVALID_DATA_TYPE,
          errorMessage: `Value '${String(rawVal)}' is invalid for datastream ${datastream.virtualPin} (expected BOOLEAN)`,
        };
      }

      normalizedValue = boolVal ? 'true' : 'false';
      numericValue = boolVal ? 1 : 0;
      break;
    }

    case 'STRING': {
      normalizedValue = String(rawVal);
      numericValue = null;
      break;
    }

    default:
      return {
        valid: false,
        errorCode: ErrorCode.INVALID_DATA_TYPE,
        errorMessage: `Unsupported datastream type ${(datastream as any).dataType}`,
      };
  }

  return {
    valid: true,
    normalizedValue,
    numericValue,
  };
}

export function parseRangeToCutoff(rangeStr?: string): string {
  const now = Date.now();
  let ms = 60 * 60 * 1000; // default 1 hour

  switch (rangeStr?.toLowerCase()) {
    case '1m':
    case '1 minute':
      ms = 1 * 60 * 1000;
      break;
    case '5m':
    case '5 minutes':
      ms = 5 * 60 * 1000;
      break;
    case '1h':
    case '1 hour':
      ms = 1 * 60 * 60 * 1000;
      break;
    case '6h':
    case '6 hours':
      ms = 6 * 60 * 60 * 1000;
      break;
    case '24h':
    case '24 hours':
    case '1d':
      ms = 24 * 60 * 60 * 1000;
      break;
    case '7d':
    case '7 days':
      ms = 7 * 24 * 60 * 60 * 1000;
      break;
  }

  return new Date(now - ms).toISOString();
}
