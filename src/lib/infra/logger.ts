import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

/**
 * Structured logger. Every pipeline stage logs with a `stage` binding so a scan
 * can be reconstructed from logs alone.
 */
export const logger = pino({
  level,
  base: { service: 'viral-coin-radar' },
  redact: {
    paths: [
      'apiKey',
      'headers.authorization',
      'headers.Authorization',
      '*.apiKey',
      '*.bearerToken',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = pino.Logger;

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
