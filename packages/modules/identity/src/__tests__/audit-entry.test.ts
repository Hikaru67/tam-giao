import { newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_META_MAX_BYTES,
  AuditEntry,
  isForbiddenMetaKey,
  validateAuditMeta,
  type AuditEntryInput,
} from '../domain/audit-entry.js';

const NOW = new Date('2026-11-18T03:00:00.000Z');
const adminId = newId<'AdminUser'>();
const base: AuditEntryInput = {
  actor: { type: 'admin', id: adminId },
  action: 'kyc.view_detail',
  targetType: 'kyc_submission',
  targetId: newId<'KycSubmission'>(),
  ip: '203.0.113.7',
  meta: { step: 'id_card', decision: null, flags: ['blurry'] },
};

const details = (input: AuditEntryInput) => {
  const r = AuditEntry.create(input, NOW);
  if (r.isOk()) throw new Error('expected Err');
  expect(r.error.code).toBe('AUDIT_ENTRY_INVALID');
  return r.error.details;
};

describe('AuditEntry.create', () => {
  it('creates an immutable entry with clock time and a UUID v7 id', () => {
    const r = AuditEntry.create(base, NOW);
    expect(r.isOk()).toBe(true);
    const s = r.unwrapOr(undefined as never).toState();
    expect(s.occurredAt).toEqual(NOW);
    expect(s.actor).toEqual({ type: 'admin', id: adminId });
    expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(s.meta).toEqual(base.meta);
  });

  it('accepts a system actor without id and defaults meta/ip', () => {
    const r = AuditEntry.create(
      {
        actor: { type: 'system' },
        action: 'kyc.purge_media',
        targetType: 'kyc_submission',
        targetId: 'abc-1',
      },
      NOW,
    );
    expect(r.isOk()).toBe(true);
    const s = r.unwrapOr(undefined as never).toState();
    expect(s).toMatchObject({ actor: { type: 'system', id: null }, ip: null, meta: {} });
  });

  it('treats ip "unknown" as missing', () => {
    const s = AuditEntry.create({ ...base, ip: 'unknown' }, NOW)
      .unwrapOr(undefined as never)
      .toState();
    expect(s.ip).toBeNull();
  });

  it.each([
    [{ actor: { type: 'robot', id: adminId } }, 'actor.type', 'UNKNOWN'],
    [{ actor: { type: 'system', id: adminId } }, 'actor.id', 'MUST_BE_NULL'],
    [{ actor: { type: 'admin' } }, 'actor.id', 'REQUIRED'],
    [{ actor: { type: 'user', id: 'not-a-uuid' } }, 'actor.id', 'NOT_UUID_V7'],
    [{ action: 'View KYC' }, 'action', 'BAD_FORMAT'],
    [{ action: 'kyc' }, 'action', 'BAD_FORMAT'],
    [{ targetType: 'Kyc Submission' }, 'targetType', 'BAD_FORMAT'],
    [{ targetId: 'Nguyễn Văn A' }, 'targetId', 'BAD_FORMAT'],
    [{ targetId: '' }, 'targetId', 'BAD_FORMAT'],
    [{ ip: '<script>' }, 'ip', 'BAD_FORMAT'],
  ] as const)('rejects invalid input %o', (patch, field, reason) => {
    expect(details({ ...base, ...patch })).toEqual({ field, reason });
  });
});

describe('audit meta must not contain raw PII (AC2)', () => {
  it.each([
    'phone',
    'phoneNumber',
    'phone_number',
    'PHONE',
    'sdt',
    'cccd',
    'cccdNumber',
    'nationalId',
    'idNumber',
    'income',
    'incomeRange',
    'assets',
    'housing',
    'photoUrl',
    'selfie',
    'messageText',
    'chatContent',
    'password',
    'otpCode',
    'refreshToken',
    'email',
    'homeAddress',
    'dateOfBirth',
    'fullName',
  ])('rejects key "%s"', (key) => {
    expect(isForbiddenMetaKey(key)).toBe(true);
    expect(details({ ...base, meta: { [key]: 'x' } })).toEqual({
      field: `meta.${key}`,
      reason: 'FORBIDDEN_KEY',
    });
  });

  it.each(['reason', 'decision', 'step', 'matchId', 'amountVnd', 'previousStatus', 'requestedDocs'])(
    'allows key "%s"',
    (key) => {
      expect(isForbiddenMetaKey(key)).toBe(false);
    },
  );

  it('checks nested objects and arrays', () => {
    expect(details({ ...base, meta: { before: { user: { phone: 'x' } } } })).toEqual({
      field: 'meta.before.user.phone',
      reason: 'FORBIDDEN_KEY',
    });
    expect(details({ ...base, meta: { changes: [{ ok: 1 }, { cccd: 'x' }] } })).toEqual({
      field: 'meta.changes[1].cccd',
      reason: 'FORBIDDEN_KEY',
    });
  });

  it('rejects non-JSON values, excessive depth and oversize meta', () => {
    expect(validateAuditMeta({ at: new Date() }).isErr()).toBe(true);
    expect(validateAuditMeta({ n: Number.NaN }).isErr()).toBe(true);
    expect(validateAuditMeta({ f: () => 1 }).isErr()).toBe(true);
    expect(validateAuditMeta({ u: undefined }).isErr()).toBe(true);
    expect(validateAuditMeta(['a']).isErr()).toBe(true);
    expect(details({ ...base, meta: { a: { b: { c: { d: { e: 1 } } } } } })).toEqual({
      field: 'meta.a.b.c.d',
      reason: 'TOO_DEEP',
    });
    expect(details({ ...base, meta: { reason: 'x'.repeat(AUDIT_META_MAX_BYTES) } })).toEqual({
      field: 'meta',
      reason: 'TOO_LARGE',
    });
  });
});
