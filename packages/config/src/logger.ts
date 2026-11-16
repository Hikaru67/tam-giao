import { pino, type DestinationStream, type Logger } from 'pino';

/**
 * Khoá chứa PII/secret bị che trong log (AGENTS.md mục 5). Áp dụng ở cấp gốc và lồng 1 cấp (`*.key`).
 * Không log trực tiếp object lồng sâu chứa PII — log id thay vì cả object.
 */
export const REDACTED_KEYS = [
  'phone',
  'phoneNumber',
  'cccd',
  'cccdNumber',
  'idNumber',
  'otp',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'secret',
  'secretAccessKey',
  'income',
  'messageBody',
  'body',
] as const;

const redactPaths = [
  ...REDACTED_KEYS,
  ...REDACTED_KEYS.map((k) => `*.${k}`),
  'req.headers.authorization',
  'req.headers.cookie',
];

export interface LoggerOptions {
  /** Tên tiến trình ghi vào mỗi dòng log (`api`, `worker`). */
  readonly service: string;
  readonly level: string;
  /** Cho test: ghi vào stream riêng thay vì stdout. */
  readonly destination?: DestinationStream;
}

export function createLogger({ service, level, destination }: LoggerOptions): Logger {
  return pino(
    {
      level,
      base: { service },
      redact: { paths: redactPaths, censor: '[REDACTED]' },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}

export type { Logger };
