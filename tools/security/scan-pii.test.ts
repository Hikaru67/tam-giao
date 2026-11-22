import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, scanText } from './scan-pii.js';

/**
 * Token giả dựng lúc chạy test (không để literal trông giống secret trong mã nguồn — tránh secret scanner báo nhầm).
 * JWT = base64url(header).base64url(payload).chữ-ký-bịa; Bearer = chuỗi lặp vô nghĩa.
 */
const b64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const FAKE_JWT = [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub: 'test-user' }), 'x'.repeat(24)].join(
  '.',
);
const FAKE_BEARER = `Bearer ${'ab'.repeat(11)}`;

describe('scanText', () => {
  it('phát hiện đúng các pattern PII ví dụ', () => {
    const text = [
      'phone: 0912345678',
      'intl phone: +84912345678',
      'citizen id: 001095012345',
      `auth: ${FAKE_BEARER}`,
      `token: ${FAKE_JWT}`,
      'email: user@gmail.com',
      'code: otp: 842913',
    ].join('\n');

    const findings = scanText('test.log', text);
    const patterns = findings.map((f) => f.pattern);

    expect(patterns).toContain('vn-phone');
    expect(patterns).toContain('cccd');
    expect(patterns).toContain('bearer-token');
    expect(patterns).toContain('jwt');
    expect(patterns).toContain('email');
    expect(patterns).toContain('otp-in-log');
    expect(findings).toHaveLength(7);
  });

  it('excerpt không chứa giá trị đầy đủ (chỉ giữ 2 ký tự đầu + ***)', () => {
    const text = [
      'phone: 0912345678',
      'cccd: 001095012345',
      `auth: ${FAKE_BEARER}`,
      'email: user@gmail.com',
      'otp: 842913',
    ].join('\n');

    const findings = scanText('test.log', text);
    for (const finding of findings) {
      expect(finding.excerpt).not.toContain('0912345678');
      expect(finding.excerpt).not.toContain('001095012345');
      expect(finding.excerpt).not.toContain(FAKE_BEARER);
      expect(finding.excerpt).not.toContain('user@gmail.com');
      expect(finding.excerpt).not.toContain('842913');
      expect(finding.excerpt.endsWith('***')).toBe(true);
    }
  });

  it('không bắt [REDACTED]', () => {
    const text = [
      'phone: [REDACTED]',
      'authorization: Bearer [REDACTED]',
      'token: eyJ[REDACTED]',
      'code: otp: [REDACTED]',
      'user: [REDACTED]',
    ].join('\n');

    const findings = scanText('test.log', text);
    expect(findings).toHaveLength(0);
  });

  it('không bắt UUID, timestamp ISO, số 11 hoặc 13 chữ số', () => {
    const text = [
      'traceId: 0190d2c4-7b1a-7b3e-8c01-123456789abc',
      'timestamp: 2026-11-20T08:00:00.000Z',
      '11 digits: 09123456789',
      '13 digits: 0912345678901',
      '13 digits cccd-like: 0010950123456',
    ].join('\n');

    const findings = scanText('test.log', text);
    expect(findings).toHaveLength(0);
  });

  it('allow 0900000000 và a@example.com', () => {
    const text = [
      'smoke test phone: 0900000000',
      'example email: a@example.com',
      'other example email: test@example.vn',
      'test domain email: dev@test',
    ].join('\n');

    const findings = scanText('test.log', text);
    expect(findings).toHaveLength(0);
  });
});

describe('main CLI', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('main([]) trả 2 khi thiếu tham số', async () => {
    const code = await main([]);
    expect(code).toBe(2);
  });

  it('main trả 0 khi file sạch, 1 khi có PII, 2 khi không đọc được file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'scan-pii-test-'));
    try {
      const cleanFile = join(tempDir, 'clean.log');
      await writeFile(
        cleanFile,
        '2026-11-20T08:00:00.000Z INFO traceId=0190d2c4-7b1a-7b3e-8c01-123456789abc phone=[REDACTED]\n',
      );

      const piiFile = join(tempDir, 'pii.log');
      await writeFile(piiFile, 'ERROR leaked phone: 0912345678\n');

      const nonExistentFile = join(tempDir, 'non-existent.log');

      expect(await main([cleanFile])).toBe(0);
      expect(await main([piiFile])).toBe(1);
      expect(await main([nonExistentFile])).toBe(2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
