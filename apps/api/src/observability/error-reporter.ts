import * as Sentry from '@sentry/node';
import type { Breadcrumb, Event } from '@sentry/node';
import { REDACTED_KEYS, type Logger } from '@tamgiao/config';

/**
 * Báo lỗi ra hệ thống theo dõi lỗi (Sentry) — port + adapter (BE-S7-08).
 * Không có DSN → `NoopErrorReporter` (dev/test không gửi gì ra ngoài).
 * Mọi event đi qua `scrubEvent` trước khi gửi: không gửi PII (AGENTS.md mục 5, Nghị định 13/2023).
 *
 * Lưu ý: file này có bản sao ở `apps/worker/src/observability/error-reporter.ts` (task chỉ cho sửa `apps/*`);
 * sửa một bên thì sửa cả bên kia.
 */
export type ErrorContext = Readonly<Record<string, unknown>>;

export interface ErrorReporter {
  /** false = no-op (không có DSN). */
  readonly enabled: boolean;
  captureException(error: unknown, context?: ErrorContext): void;
  captureMessage(message: string, level: 'warning' | 'error', context?: ErrorContext): void;
  /** Đợi gửi hết event đang chờ (gọi lúc shutdown). */
  flush(timeoutMs: number): Promise<void>;
}

export class NoopErrorReporter implements ErrorReporter {
  readonly enabled = false;
  captureException(): void {}
  captureMessage(): void {}
  async flush(): Promise<void> {}
}

export interface ErrorReporterOptions {
  readonly dsn?: string | undefined;
  /** `staging`, `production`… */
  readonly environment: string;
  /** Phiên bản image (git sha) — để nhóm lỗi theo bản deploy. */
  readonly release?: string | undefined;
  /** `api` | `worker` — gắn tag `service`. */
  readonly service: string;
}

export class SentryErrorReporter implements ErrorReporter {
  readonly enabled = true;

  constructor(options: Required<Pick<ErrorReporterOptions, 'dsn'>> & ErrorReporterOptions) {
    Sentry.init({
      dsn: options.dsn,
      environment: options.environment,
      ...(options.release ? { release: options.release } : {}),
      // Không tự thu IP/thông tin user, cookie, header, body, query string, biến cục bộ của stack frame.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        databaseQueryData: false,
        queues: false,
        stackFrameVariables: false,
      },
      // Chỉ bắt lỗi — không tracing/profiling (giảm phụ thuộc & dữ liệu gửi đi).
      tracesSampleRate: 0,
      defaultIntegrations: false,
      integrations: [
        Sentry.linkedErrorsIntegration(),
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration(),
      ],
      initialScope: { tags: { service: options.service } },
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    });
  }

  captureException(error: unknown, context?: ErrorContext): void {
    Sentry.captureException(error, context ? { extra: { ...context } } : undefined);
  }

  captureMessage(message: string, level: 'warning' | 'error', context?: ErrorContext): void {
    Sentry.captureMessage(message, { level, ...(context ? { extra: { ...context } } : {}) });
  }

  async flush(timeoutMs: number): Promise<void> {
    await Sentry.flush(timeoutMs);
  }
}

export function createErrorReporter(options: ErrorReporterOptions): ErrorReporter {
  const dsn = options.dsn?.trim();
  if (!dsn) return new NoopErrorReporter();
  return new SentryErrorReporter({ ...options, dsn });
}

// ── Scrub PII ────────────────────────────────────────────────────────────────

const REDACTED = '[REDACTED]';

/** Khoá (so sánh không phân biệt hoa thường, bỏ `_`/`-`) bị thay bằng `[REDACTED]` ở mọi độ sâu. */
const PII_KEYS = new Set(
  [
    ...REDACTED_KEYS,
    'email',
    'ip',
    'ipAddress',
    'clientIp',
    'xForwardedFor',
    'xRealIp',
    'setCookie',
    'fullName',
    'displayName',
    'address',
    'birthDate',
    'dateOfBirth',
    'code',
    'pin',
    'text',
    'content',
    'message_body',
    'staffNote',
    'notes',
  ].map(normalizeKey),
);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

/** Mẫu PII có thể lọt vào chuỗi tự do (message lỗi, breadcrumb): SĐT VN, CCCD 12 số, email, JWT, OTP 6 số. */
const TEXT_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[TOKEN]'],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[EMAIL]'],
  // Dãy số đứng riêng (không dính chữ/`-`) để không che nhầm một phần UUID.
  [/(?<![\w-])(\+?84|0)(3|5|7|8|9)\d{8}(?![\w-])/g, '[PHONE]'],
  [/(?<![\w-])\d{12}(?![\w-])/g, '[ID_NUMBER]'],
  [/(?<![\w-])\d{6}(?![\w-])/g, '[CODE]'],
];

export function scrubText(text: string): string {
  return TEXT_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

const MAX_DEPTH = 8;

export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = PII_KEYS.has(normalizeKey(key)) ? REDACTED : scrubValue(v, depth + 1);
  }
  return out;
}

/** Header request được giữ lại (còn lại bỏ hết — gồm authorization, cookie, x-forwarded-for). */
const SAFE_HEADERS = new Set(['user-agent', 'content-type', 'content-length', 'accept', 'x-request-id']);

/** Làm sạch event trước khi gửi Sentry. Trả về chính event (đã sửa tại chỗ) để dùng trong `beforeSend`. */
export function scrubEvent<T extends Event>(event: T): T {
  // Chỉ giữ id người dùng (UUID) — không email, IP, tên.
  if (event.user) event.user = event.user.id === undefined ? {} : { id: event.user.id };
  if (event.request) {
    const { method, url, headers } = event.request;
    event.request = {
      ...(method ? { method } : {}),
      // Bỏ query string (có thể chứa access_token của WS, số điện thoại…).
      ...(url ? { url: url.split('?')[0] } : {}),
      ...(headers
        ? {
            headers: Object.fromEntries(
              Object.entries(headers).filter(([k]) => SAFE_HEADERS.has(k.toLowerCase())),
            ),
          }
        : {}),
    };
  }
  if (event.message) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  if (event.extra) event.extra = scrubValue(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  if (event.tags) event.tags = scrubValue(event.tags) as typeof event.tags;
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  delete event.server_name;
  return event;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    ...breadcrumb,
    ...(breadcrumb.message ? { message: scrubText(breadcrumb.message) } : {}),
    ...(breadcrumb.data ? { data: scrubValue(breadcrumb.data) as Record<string, unknown> } : {}),
  };
}

// ── Nối logger → reporter ────────────────────────────────────────────────────

type LogFn = (...args: unknown[]) => unknown;

/**
 * Bọc logger pino: mọi lần `logger.error/fatal` (kể cả logger con theo request) cũng được báo cho reporter.
 * Chỉ gửi Error + câu log, **không** gửi object ngữ cảnh của log (có thể chứa PII) — Sentry còn scrub lần nữa.
 */
export function withErrorReporting(logger: Logger, reporter: ErrorReporter): Logger {
  if (!reporter.enabled) return logger;
  return new Proxy(logger, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const fn = value as LogFn;
      if (prop === 'error' || prop === 'fatal') {
        return (...args: unknown[]) => {
          report(reporter, args, prop === 'fatal' ? 'fatal' : 'error');
          return fn.apply(target, args);
        };
      }
      if (prop === 'child') {
        return (...args: unknown[]) => withErrorReporting(fn.apply(target, args) as Logger, reporter);
      }
      return fn.bind(target);
    },
  });
}

function report(reporter: ErrorReporter, args: readonly unknown[], level: 'error' | 'fatal'): void {
  const [first, second] = args;
  const message =
    typeof first === 'string' ? first : typeof second === 'string' ? second : 'error logged without message';
  let error: unknown;
  if (first instanceof Error) error = first;
  else if (typeof first === 'object' && first !== null && 'err' in first && first.err instanceof Error) {
    error = first.err;
  }
  if (error !== undefined) reporter.captureException(error, { log: message, level });
  else reporter.captureMessage(message, 'error', { level });
}
