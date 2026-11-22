import { createLogger } from '@tamgiao/config';
import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import {
  NoopErrorReporter,
  createErrorReporter,
  scrubBreadcrumb,
  scrubEvent,
  scrubText,
  withErrorReporting,
  type ErrorContext,
  type ErrorReporter,
} from '../error-reporter.js';

class RecordingReporter implements ErrorReporter {
  readonly enabled = true;
  readonly exceptions: { error: unknown; context?: ErrorContext | undefined }[] = [];
  readonly messages: { message: string; level: string; context?: ErrorContext | undefined }[] = [];
  captureException(error: unknown, context?: ErrorContext): void {
    this.exceptions.push({ error, context });
  }
  captureMessage(message: string, level: 'warning' | 'error', context?: ErrorContext): void {
    this.messages.push({ message, level, context });
  }
  async flush(): Promise<void> {}
}

const silentLogger = () =>
  createLogger({ service: 'test', level: 'debug', destination: { write: () => undefined } });

describe('createErrorReporter', () => {
  it('không có DSN (hoặc DSN rỗng) → no-op, không khởi tạo Sentry', async () => {
    for (const dsn of [undefined, '', '   ']) {
      const reporter = createErrorReporter({ dsn, environment: 'test', service: 'api' });
      expect(reporter).toBeInstanceOf(NoopErrorReporter);
      expect(reporter.enabled).toBe(false);
      reporter.captureException(new Error('x'));
      reporter.captureMessage('x', 'error');
      await expect(reporter.flush(10)).resolves.toBeUndefined();
    }
  });
});

/** JWT giả dựng lúc chạy (không để literal trông giống secret — tránh secret scanner báo nhầm). */
function fakeJwt(): string {
  const b64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [b64url({ alg: 'HS256' }), b64url({ sub: '1' }), 'abc-def_123'].join('.');
}

describe('scrubText', () => {
  it('che SĐT VN, CCCD 12 số, email, JWT, mã 6 số trong chuỗi tự do', () => {
    const text =
      'user 0912345678 / +84987654321 cccd 001095012345 mail a.b@example.com otp 842913 ' +
      `token ${fakeJwt()}`;
    const scrubbed = scrubText(text);
    expect(scrubbed).toBe('user [PHONE] / [PHONE] cccd [ID_NUMBER] mail [EMAIL] otp [CODE] token [TOKEN]');
  });

  it('giữ nguyên chuỗi không có PII (uuid, mã lỗi)', () => {
    const text = 'MATCH_NOT_FOUND 0190a3f2-7c1e-7a00-8000-000000000001';
    expect(scrubText(text)).toBe(text);
  });
});

describe('scrubEvent', () => {
  it('bỏ PII khỏi user, request, message, exception, extra, contexts, breadcrumbs', () => {
    const event: ErrorEvent = {
      type: undefined,
      message: 'gửi OTP tới 0912345678 thất bại',
      server_name: 'host-1',
      user: { id: 'u-1', email: 'a@b.vn', ip_address: '1.2.3.4', username: 'An' },
      request: {
        method: 'POST',
        url: 'https://api.example.com/ws?access_token=eyJa.eyJb.c&phone=0912345678',
        headers: {
          authorization: 'Bearer x',
          cookie: 'sid=1',
          'user-agent': 'k6',
          'x-forwarded-for': '1.2.3.4',
        },
        data: { phone: '0912345678' },
        cookies: { sid: '1' },
        query_string: 'phone=0912345678',
      },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'duplicate cccd 001095012345',
            stacktrace: { frames: [{ filename: 'a.ts', vars: { phone: '0912345678' } }] },
          },
        ],
      },
      extra: {
        phone: '0912345678',
        nested: { cccdNumber: '001095012345', ok: 'match m-1' },
        note: 'gọi 0912345678',
      },
      contexts: { job: { queue: 'billing.refund', income: 1000 } },
      breadcrumbs: [{ message: 'otp 842913 sent', data: { token: 'abc', url: '/me' } }],
    };

    const out = scrubEvent(event);
    expect(out.user).toEqual({ id: 'u-1' });
    expect(out.request).toEqual({
      method: 'POST',
      url: 'https://api.example.com/ws',
      headers: { 'user-agent': 'k6' },
    });
    expect(out.message).toBe('gửi OTP tới [PHONE] thất bại');
    expect(out.server_name).toBeUndefined();
    expect(out.exception?.values?.[0]?.value).toBe('duplicate cccd [ID_NUMBER]');
    expect(out.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toBeUndefined();
    expect(out.extra).toEqual({
      phone: '[REDACTED]',
      nested: { cccdNumber: '[REDACTED]', ok: 'match m-1' },
      note: 'gọi [PHONE]',
    });
    expect(out.contexts).toEqual({ job: { queue: 'billing.refund', income: '[REDACTED]' } });
    expect(out.breadcrumbs).toEqual([
      { message: 'otp [CODE] sent', data: { token: '[REDACTED]', url: '/me' } },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/0912345678|001095012345|842913|a@b\.vn|1\.2\.3\.4/);
  });

  it('scrubBreadcrumb giữ breadcrumb không có message/data', () => {
    expect(scrubBreadcrumb({ category: 'http', level: 'info' })).toEqual({ category: 'http', level: 'info' });
  });
});

describe('withErrorReporting', () => {
  it('reporter no-op → trả lại đúng logger gốc', () => {
    const logger = silentLogger();
    expect(withErrorReporting(logger, new NoopErrorReporter())).toBe(logger);
  });

  it('logger.error({err}) / error(Error) / fatal(msg) → báo reporter; info/warn không báo; logger con cũng báo', () => {
    const reporter = new RecordingReporter();
    const logger = withErrorReporting(silentLogger(), reporter);
    const boom = new Error('boom');

    logger.info({ phone: '0912345678' }, 'info line');
    logger.warn('warn line');
    logger.error({ err: boom, phone: '0912345678' }, 'unhandled error');
    logger.error(boom);
    logger.fatal('fatal without error');
    logger.child({ requestId: 'r-1' }).error({ err: boom }, 'from child');

    expect(reporter.exceptions).toEqual([
      { error: boom, context: { log: 'unhandled error', level: 'error' } },
      { error: boom, context: { log: 'error logged without message', level: 'error' } },
      { error: boom, context: { log: 'from child', level: 'error' } },
    ]);
    expect(reporter.messages).toEqual([
      { message: 'fatal without error', level: 'error', context: { level: 'fatal' } },
    ]);
    // Không chuyển object ngữ cảnh của log (có thể chứa PII) sang reporter.
    expect(JSON.stringify(reporter.exceptions.map((e) => e.context))).not.toContain('0912345678');
  });

  it('logger bọc vẫn ghi log bình thường (pino)', () => {
    const lines: string[] = [];
    const logger = withErrorReporting(
      createLogger({
        service: 'test',
        level: 'info',
        destination: { write: (l: string) => void lines.push(l) },
      }),
      new RecordingReporter(),
    );
    logger.child({ a: 1 }).error({ err: new Error('x') }, 'logged');
    logger.level = 'error';
    logger.info('dropped');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ msg: 'logged', a: 1, service: 'test' });
  });
});
