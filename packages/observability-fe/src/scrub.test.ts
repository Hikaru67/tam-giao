import { describe, expect, it } from 'vitest';
import { REDACTED, SENSITIVE_KEYS, scrubBreadcrumb, scrubData, scrubEvent, scrubString } from './scrub.js';

const SAMPLE_UUID = '0192f0c4-7d1e-7abc-8def-0123456789ab';

describe('scrubString', () => {
  it('masks Vietnamese phone numbers across common formats', () => {
    const cases = [
      { input: '0912345678', raw: '0912345678' },
      { input: '+84912345678', raw: '+84912345678' },
      { input: '84 912 345 678', raw: '84 912 345 678' },
      { input: '0912.345.678', raw: '0912.345.678' },
      { input: 'Gọi em 0987654321 nhé', raw: '0987654321' },
    ];

    for (const { input, raw } of cases) {
      const result = scrubString(input);
      expect(result).toContain('[PHONE]');
      expect(result).not.toContain(raw);
    }
  });

  it('masks 12-digit CCCD and 9-digit CMND', () => {
    expect(scrubString('001234567890')).toBe('[CCCD]');
    expect(scrubString('123456789')).toBe('[ID]');
  });

  it('masks JWT and Bearer tokens', () => {
    expect(scrubString('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc_DEF-123')).toBe('[JWT]');

    const authHeader = scrubString('Authorization: Bearer abc.def-ghi');
    expect(authHeader).toContain('Bearer [REDACTED]');
    expect(authHeader).not.toContain('abc.def-ghi');
  });

  it('masks email addresses and Expo push tokens', () => {
    expect(scrubString('an.nguyen@example.com')).toBe('[EMAIL]');

    const expo = scrubString('ExponentPushToken[xxxxYYYY]');
    expect(expo).not.toContain('xxxxYYYY');
    expect(expo).toBe('ExponentPushToken[REDACTED]');
  });

  it('masks sensitive query parameters while preserving non-sensitive ones', () => {
    const result = scrubString('https://api.test/ws?token=abc123&x=1');
    expect(result).toContain('token=[REDACTED]');
    expect(result).toContain('x=1');
    expect(result).not.toContain('abc123');
  });

  it('preserves regular numbers and UUID paths', () => {
    expect(scrubString('Order 42 failed at step 3')).toBe('Order 42 failed at step 3');
    expect(scrubString(`/chat/${SAMPLE_UUID}`)).toBe(`/chat/${SAMPLE_UUID}`);
  });
});

describe('scrubData', () => {
  it('masks sensitive keys case-insensitively and preserves traceId', () => {
    expect(SENSITIVE_KEYS).toContain('phone');
    expect(SENSITIVE_KEYS).toContain('content');

    const input = {
      phone: '0912345678',
      nested: {
        refreshToken: 'r1',
        note: 'ok',
      },
      list: ['a@b.co'],
      Authorization: 'Bearer x',
      traceId: 'abc123456789012def',
    };

    const result = scrubData(input);
    expect(result).toEqual({
      phone: REDACTED,
      nested: {
        refreshToken: REDACTED,
        note: 'ok',
      },
      list: ['[EMAIL]'],
      Authorization: REDACTED,
      traceId: 'abc123456789012def',
    });
  });

  it('does not throw on circular references', () => {
    const circular: Record<string, unknown> = { note: 'safe' };
    circular['self'] = circular;

    expect(() => scrubData(circular)).not.toThrow();
    expect(scrubData(circular)).toEqual({
      note: 'safe',
      self: '[Circular]',
    });
  });
});

describe('scrubBreadcrumb', () => {
  it('scrubs message and data while keeping UUIDs intact', () => {
    const result = scrubBreadcrumb({
      category: 'chat',
      message: 'sent to 0912345678',
      data: {
        content: 'Bí mật',
        conversationId: SAMPLE_UUID,
      },
    });

    expect(result).toEqual({
      category: 'chat',
      message: 'sent to [PHONE]',
      data: {
        content: REDACTED,
        conversationId: SAMPLE_UUID,
      },
    });
  });
});

describe('scrubEvent', () => {
  it('removes user/server_name, scrubs PII across fields, and leaves original input untouched', () => {
    const event = {
      message: 'Gọi cho 0912345678',
      user: {
        id: 'u1',
        email: 'a@b.co',
        ip_address: '1.2.3.4',
      },
      server_name: 'worker-01',
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc_DEF-123',
            mechanism: { type: 'generic', handled: true },
          },
        ],
      },
      request: {
        url: 'https://api.test/me?token=abc',
        method: 'GET',
        headers: {
          Authorization: 'Bearer t',
          Cookie: 'sid=1',
          'User-Agent': 'UA',
        },
        cookies: { sid: '1' },
        data: { phone: '0912345678' },
        query_string: 'token=abc',
      },
      breadcrumbs: [
        {
          category: 'chat',
          message: 'message sent',
          data: {
            content: 'Em ơi 0912345678',
            conversationId: SAMPLE_UUID,
          },
        },
        {
          category: 'fetch',
          data: {
            url: 'https://api.test/x?token=abc',
            method: 'GET',
            status_code: 500,
          },
        },
      ],
      extra: {
        body: 'nội dung',
        note: 'gọi 0912345678',
      },
      tags: {
        traceId: 'trace-123',
      },
    };

    const originalSnapshot = structuredClone(event);
    const result = scrubEvent(event);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('0912345678');
    expect(serialized).not.toContain('eyJ');
    expect(serialized).not.toContain('a@b.co');
    expect(serialized).not.toContain('token=abc');
    expect(serialized).not.toContain('1.2.3.4');
    expect(serialized).not.toContain('Em ơi');

    expect(result.user).toBeUndefined();
    expect(result.server_name).toBeUndefined();
    expect(result.request.cookies).toBeUndefined();
    expect(result.request.data).toBeUndefined();
    expect(result.request.query_string).toBeUndefined();
    expect(result.request.url).toBe('https://api.test/me?token=[REDACTED]');
    expect(result.request.method).toBe('GET');
    expect(result.request.headers).toEqual({
      Authorization: REDACTED,
      Cookie: REDACTED,
      'User-Agent': 'UA',
    });

    expect(result.breadcrumbs[0]?.data).toEqual({
      content: REDACTED,
      conversationId: SAMPLE_UUID,
    });
    expect(result.breadcrumbs[1]?.data).toEqual({
      url: 'https://api.test/x?token=[REDACTED]',
      method: 'GET',
      status_code: 500,
    });

    expect(result.tags).toEqual({ traceId: 'trace-123' });
    expect(result.extra).toEqual({
      body: REDACTED,
      note: 'gọi [PHONE]',
    });
    expect(event).toEqual(originalSnapshot);
  });
});
