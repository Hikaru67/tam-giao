import { VOUCHER_TTL_DAYS, VOUCHER_VND } from '@tamgiao/contracts/constants';
import { FakeClock, Money, addDuration, newId, type Result } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import type { VerificationPaymentId } from '../domain/verification-payment.js';
import { VOUCHER_STATUSES, Voucher, type VoucherId, type VoucherStatus } from '../domain/voucher.js';

const T0 = new Date('2026-11-01T00:00:00.000Z');
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);
const APPROVED_AT = at(60);
const EXPIRES_AT = addDuration(APPROVED_AT, { days: VOUCHER_TTL_DAYS });
const USER_ID = newId<'User'>();
const PAYMENT_ID = newId<'VerificationPayment'>() as VerificationPaymentId;
const PARTNER_A = newId<'Partner'>();
const PARTNER_B = newId<'Partner'>();

const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.isErr()) throw new Error(`expected Ok, got ${JSON.stringify(result.error)}`);
  return result.value;
};

const errCode = <T, E extends { code: string }>(result: Result<T, E>): string => {
  if (result.isOk()) throw new Error('expected Err');
  return result.error.code;
};

const issue = (partnerId: string | null = null): Voucher =>
  Voucher.issue(
    { id: newId<'Voucher'>() as VoucherId, userId: USER_ID, paymentId: PAYMENT_ID, partnerId },
    T0,
  );

/** Dựng voucher ở trạng thái cho trước bằng chuỗi chuyển hợp lệ (đã có hạn dùng), xoá event. */
const inStatus = (status: VoucherStatus): Voucher => {
  const v = issue();
  unwrap(v.setExpiryFromApproval(APPROVED_AT, APPROVED_AT));
  if (status === 'ACTIVE' || status === 'REDEEMED') unwrap(v.activate(at(120)));
  if (status === 'REDEEMED') unwrap(v.redeem(PARTNER_A, at(180)));
  if (status === 'VOID') unwrap(v.void('PAYMENT_REFUNDED', at(120)));
  if (status === 'EXPIRED') unwrap(v.expire(EXPIRES_AT));
  v.pullEvents();
  return v;
};

const TERMINAL: VoucherStatus[] = ['REDEEMED', 'VOID', 'EXPIRED'];
const TERMINAL_CODE: Record<string, string> = {
  REDEEMED: 'VOUCHER_ALREADY_REDEEMED',
  VOID: 'VOUCHER_NOT_ACTIVE',
  EXPIRED: 'VOUCHER_EXPIRED',
};

describe('Voucher.issue', () => {
  it('creates RESERVED voucher worth VOUCHER_VND, no expiry yet, records VoucherIssued', () => {
    const v = issue();
    expect(v.status).toBe('RESERVED');
    expect(v.value.equals(Money.ofTrusted(VOUCHER_VND))).toBe(true);
    expect(v.expiresAt).toBeNull();
    expect(v.partnerId).toBeNull();
    expect(v.paymentId).toBe(PAYMENT_ID);
    expect(v.pullEvents()).toMatchObject([
      {
        type: 'VoucherIssued',
        aggregateType: 'Voucher',
        aggregateId: v.id,
        version: 1,
        occurredAt: T0,
        payload: { voucherId: v.id, userId: USER_ID, paymentId: PAYMENT_ID, valueVnd: VOUCHER_VND },
      },
    ]);
  });

  it('accepts an optional partner', () => {
    expect(issue(PARTNER_A).partnerId).toBe(PARTNER_A);
  });
});

describe('Voucher expiry from approval', () => {
  it('sets expiresAt = approvedAt + VOUCHER_TTL_DAYS without event', () => {
    const v = issue();
    v.pullEvents();
    unwrap(v.setExpiryFromApproval(APPROVED_AT, at(61)));
    expect(v.expiresAt).toEqual(new Date(APPROVED_AT.getTime() + VOUCHER_TTL_DAYS * 86_400_000));
    expect(v.version).toBe(1);
    expect(v.pullEvents()).toEqual([]);
  });

  it('cannot be set twice', () => {
    const v = inStatus('RESERVED');
    expect(errCode(v.setExpiryFromApproval(at(500), at(500)))).toBe('VOUCHER_INVALID_TRANSITION');
    expect(v.expiresAt).toEqual(EXPIRES_AT);
  });

  it.each(TERMINAL)('cannot be set on %s voucher', (status) => {
    const v = inStatus(status);
    expect(errCode(v.setExpiryFromApproval(at(500), at(500)))).toBe(TERMINAL_CODE[status]);
  });

  it('isPastExpiry is inclusive at expiresAt and false when no expiry', () => {
    expect(issue().isPastExpiry(at(10_000_000))).toBe(false);
    const v = inStatus('RESERVED');
    expect(v.isPastExpiry(new Date(EXPIRES_AT.getTime() - 1))).toBe(false);
    expect(v.isPastExpiry(EXPIRES_AT)).toBe(true);
  });
});

describe('Voucher valid transitions', () => {
  it('RESERVED → ACTIVE records VoucherActivated with expiresAt', () => {
    const v = inStatus('RESERVED');
    unwrap(v.activate(at(120)));
    expect(v.status).toBe('ACTIVE');
    expect(v.pullEvents()).toMatchObject([
      {
        type: 'VoucherActivated',
        version: 2,
        payload: { voucherId: v.id, userId: USER_ID, expiresAt: EXPIRES_AT.toISOString() },
      },
    ]);
  });

  it('ACTIVE → REDEEMED (unbound voucher, any partner) records VoucherRedeemed', () => {
    const clock = new FakeClock(at(180));
    const v = inStatus('ACTIVE');
    unwrap(v.redeem(PARTNER_B, clock.now()));
    expect(v.status).toBe('REDEEMED');
    expect(v.toState()).toMatchObject({ redeemedAt: at(180), redeemedByPartnerId: PARTNER_B });
    expect(v.pullEvents()).toMatchObject([
      { type: 'VoucherRedeemed', payload: { voucherId: v.id, partnerId: PARTNER_B, valueVnd: VOUCHER_VND } },
    ]);
  });

  it('redeems just before expiry', () => {
    const v = inStatus('ACTIVE');
    unwrap(v.redeem(PARTNER_A, new Date(EXPIRES_AT.getTime() - 1)));
    expect(v.status).toBe('REDEEMED');
  });

  it('bound voucher redeems at its partner', () => {
    const v = inStatus('ACTIVE');
    unwrap(v.assignPartner(PARTNER_A, at(130)));
    unwrap(v.redeem(PARTNER_A, at(180)));
    expect(v.status).toBe('REDEEMED');
  });

  it.each<VoucherStatus>(['RESERVED', 'ACTIVE'])('%s → VOID records VoucherVoided', (status) => {
    const v = inStatus(status);
    unwrap(v.void('PAYMENT_REFUNDED', at(200)));
    expect(v.status).toBe('VOID');
    expect(v.toState()).toMatchObject({ voidReason: 'PAYMENT_REFUNDED', voidedAt: at(200) });
    expect(v.pullEvents()).toMatchObject([
      {
        type: 'VoucherVoided',
        payload: {
          voucherId: v.id,
          paymentId: PAYMENT_ID,
          reason: 'PAYMENT_REFUNDED',
          valueVnd: VOUCHER_VND,
        },
      },
    ]);
  });

  it.each<VoucherStatus>(['RESERVED', 'ACTIVE'])(
    '%s → EXPIRED at expiresAt records VoucherExpired',
    (status) => {
      const clock = new FakeClock(APPROVED_AT);
      const v = inStatus(status);
      clock.advance({ days: VOUCHER_TTL_DAYS });
      unwrap(v.expire(clock.now()));
      expect(v.status).toBe('EXPIRED');
      expect(v.pullEvents()).toMatchObject([
        { type: 'VoucherExpired', payload: { voucherId: v.id, userId: USER_ID, valueVnd: VOUCHER_VND } },
      ]);
    },
  );
});

describe('Voucher invalid transitions (full matrix)', () => {
  // AC2: REDEEMED/VOID/EXPIRED không thể chuyển tiếp.
  describe.each(TERMINAL)('terminal %s', (status) => {
    const code = TERMINAL_CODE[status];
    const actions: [string, (v: Voucher) => Result<void, { code: string }>][] = [
      ['activate', (v) => v.activate(at(130))],
      ['redeem', (v) => v.redeem(PARTNER_A, at(130))],
      ['void', (v) => v.void('ADMIN', at(130))],
      ['expire', (v) => v.expire(addDuration(EXPIRES_AT, { days: 1 }))],
      ['assignPartner', (v) => v.assignPartner(PARTNER_B, at(130))],
    ];
    it.each(actions)(`%s → ${String(code)}, state unchanged`, (_name, action) => {
      const v = inStatus(status);
      const before = v.toState();
      expect(errCode(action(v))).toBe(code);
      expect(v.toState()).toEqual(before);
      expect(v.pullEvents()).toEqual([]);
    });
  });

  it('activate from ACTIVE → VOUCHER_INVALID_TRANSITION', () => {
    expect(errCode(inStatus('ACTIVE').activate(at(130)))).toBe('VOUCHER_INVALID_TRANSITION');
  });

  it('activate before approval (no expiry) → VOUCHER_INVALID_TRANSITION', () => {
    const v = issue();
    expect(errCode(v.activate(at(1)))).toBe('VOUCHER_INVALID_TRANSITION');
    expect(v.status).toBe('RESERVED');
  });

  it('activate after expiry → VOUCHER_EXPIRED', () => {
    const v = inStatus('RESERVED');
    expect(errCode(v.activate(EXPIRES_AT))).toBe('VOUCHER_EXPIRED');
    expect(v.status).toBe('RESERVED');
  });

  it('redeem RESERVED → VOUCHER_NOT_ACTIVE', () => {
    expect(errCode(inStatus('RESERVED').redeem(PARTNER_A, at(130)))).toBe('VOUCHER_NOT_ACTIVE');
  });

  it('redeem ACTIVE past expiry (by Clock) → VOUCHER_EXPIRED', () => {
    const clock = new FakeClock(at(130));
    const v = inStatus('ACTIVE');
    clock.set(EXPIRES_AT);
    expect(errCode(v.redeem(PARTNER_A, clock.now()))).toBe('VOUCHER_EXPIRED');
    expect(v.status).toBe('ACTIVE');
  });

  it('redeem at another partner when bound → VOUCHER_PARTNER_MISMATCH', () => {
    const v = inStatus('ACTIVE');
    unwrap(v.assignPartner(PARTNER_A, at(130)));
    expect(errCode(v.redeem(PARTNER_B, at(180)))).toBe('VOUCHER_PARTNER_MISMATCH');
    expect(v.status).toBe('ACTIVE');
    expect(v.pullEvents()).toEqual([]);
  });

  it.each<VoucherStatus>(['RESERVED', 'ACTIVE'])(
    'expire %s before expiresAt → VOUCHER_INVALID_TRANSITION',
    (status) => {
      const v = inStatus(status);
      expect(errCode(v.expire(new Date(EXPIRES_AT.getTime() - 1)))).toBe('VOUCHER_INVALID_TRANSITION');
      expect(v.status).toBe(status);
    },
  );

  it('expire without expiry (never approved) → VOUCHER_INVALID_TRANSITION', () => {
    expect(errCode(issue().expire(at(10_000_000)))).toBe('VOUCHER_INVALID_TRANSITION');
  });

  it('every status is covered by the matrix', () => {
    expect([...VOUCHER_STATUSES].sort()).toEqual(['ACTIVE', 'EXPIRED', 'REDEEMED', 'RESERVED', 'VOID']);
  });
});

describe('Voucher.assignPartner', () => {
  it('assigns once, same partner is a no-op, different partner rejected', () => {
    const v = inStatus('RESERVED');
    unwrap(v.assignPartner(PARTNER_A, at(70)));
    unwrap(v.assignPartner(PARTNER_A, at(71)));
    expect(v.partnerId).toBe(PARTNER_A);
    expect(errCode(v.assignPartner(PARTNER_B, at(72)))).toBe('VOUCHER_INVALID_TRANSITION');
    expect(v.partnerId).toBe(PARTNER_A);
  });
});

describe('Voucher persistence round-trip', () => {
  it('restore(toState()) keeps state and version', () => {
    const v = inStatus('ACTIVE');
    const restored = Voucher.restore(v.toState());
    expect(restored.toState()).toEqual(v.toState());
    unwrap(restored.redeem(PARTNER_A, at(180)));
    expect(restored.pullEvents()[0]?.version).toBe(v.version + 1);
  });
});
