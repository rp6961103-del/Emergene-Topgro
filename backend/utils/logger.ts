import crypto from 'crypto';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface LogContext {
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  ip?: string;
  [key: string]: any;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'jwt',
  'secret',
  'authorization',
  'cookie',
  'refreshtoken',
  'accesstoken'
]);

export function sanitize(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(item => sanitize(item));
  }

  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitize(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

function formatMessage(
  level: LogLevel,
  message: string,
  context?: LogContext
): string {
  const timestamp = new Date().toISOString();
  const reqPart = context?.requestId ? ` [req:${context.requestId}]` : '';
  const httpPart = context?.method && context?.path
    ? ` ${context.method} ${context.path}`
    : '';
  const statusPart = context?.statusCode !== undefined
    ? ` ${context.statusCode}`
    : '';
  const durationPart = context?.durationMs !== undefined
    ? ` ${context.durationMs}ms`
    : '';

  return `[${timestamp}] ${level}${reqPart}${httpPart}${statusPart}${durationPart} - ${message}`;
}

export const logger = {
  info(message: string, context?: LogContext) {
    console.log(formatMessage('INFO', message, context));
  },

  warn(message: string, context?: LogContext) {
    console.warn(formatMessage('WARN', message, context));
  },

  error(message: string, error?: unknown, context?: LogContext) {
    const errObj = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error;

    console.error(formatMessage('ERROR', message, context));
    if (errObj && (process.env.NODE_ENV !== 'production' || !(error instanceof Error))) {
      console.error('Details:', errObj);
    } else if (error instanceof Error) {
      console.error(`Error: ${error.name} - ${error.message}`);
    }
  },

  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(formatMessage('DEBUG', message, context));
    }
  }
};
