import { DEPOSIT_VND, VOUCHER_VND } from '@tamgiao/contracts/constants';
import { Money, newId, type Result } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import {
  LEDGER_ENTRY_TYPES,
  LedgerEntry,
  type LedgerEntryId,
  type LedgerEntryProps,
  type LedgerEntryType,
} from '../domain/ledger-entry.js';
import type { VerificationPaymentId } from '../domain/verification-payment.js';
import type { VoucherId } from '../domain/voucher.js';

const T0 = new Date('2026-11-01T00:00:00.000Z');
const PAYMENT_ID = newId<'VerificationPayment'>() as VerificationPaymentId;
const VOUCHER_ID = newId<'Voucher'>() as VoucherId;

const errCode = <T, E extends { code: string }>(result: Result<T, E>): string => {
  if (result.isOk()) throw new Error('expected Err');
  return result.error.code;
};

const props = (overrides: Partial<LedgerEntryProps> = {}): LedgerEntryProps => ({
  id: newId<'LedgerEntry'>() as LedgerEntryId,
  type: 'CHARGE',
  amount: Money.ofTrusted(DEPOSIT_VND),
  userId: newId<'User'>(),
  paymentId: PAYMENT_ID,
  voucherId: null,
  occurredAt: T0,
  ...overrides,
});

describe('LedgerEntry.create', () => {
  it.each<LedgerEntryType>(['CHARGE', 'REFUND'])('%s with paymentId', (type) => {
    const result = LedgerEntry.create(props({ type }));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.type).toBe(type);
      expect(result.value.amount.amount).toBe(BigInt(DEPOSIT_VND));
    }
  });

  it.each<LedgerEntryType>(['VOUCHER_ISSUE', 'VOUCHER_REDEEM', 'VOUCHER_VOID'])(
    '%s with voucherId',
    (type) => {
      const result = LedgerEntry.create(
        props({ type, amount: Money.ofTrusted(VOUCHER_VND), paymentId: null, voucherId: VOUCHER_ID }),
      );
      expect(result.isOk()).toBe(true);
    },
  );

  it.each<LedgerEntryType>(['CHARGE', 'REFUND'])(
    '%s without paymentId → LEDGER_REFERENCE_REQUIRED',
    (type) => {
      expect(errCode(LedgerEntry.create(props({ type, paymentId: null, voucherId: VOUCHER_ID })))).toBe(
        'LEDGER_REFERENCE_REQUIRED',
      );
    },
  );

  it.each<LedgerEntryType>(['VOUCHER_ISSUE', 'VOUCHER_REDEEM', 'VOUCHER_VOID'])(
    '%s without voucherId → LEDGER_REFERENCE_REQUIRED',
    (type) => {
      expect(errCode(LedgerEntry.create(props({ type, voucherId: null })))).toBe('LEDGER_REFERENCE_REQUIRED');
    },
  );

  it.each(LEDGER_ENTRY_TYPES)('%s with zero amount → LEDGER_AMOUNT_INVALID', (type) => {
    expect(errCode(LedgerEntry.create(props({ type, amount: Money.ZERO, voucherId: VOUCHER_ID })))).toBe(
      'LEDGER_AMOUNT_INVALID',
    );
  });
});

describe('LedgerEntry immutability', () => {
  it('is frozen and copies occurredAt', () => {
    const occurredAt = new Date(T0.getTime());
    const result = LedgerEntry.create(props({ occurredAt }));
    if (result.isErr()) throw new Error('expected Ok');
    const entry = result.value;
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() => {
      (entry as unknown as { type: string }).type = 'REFUND';
    }).toThrow(TypeError);
    occurredAt.setTime(0);
    expect(entry.occurredAt).toEqual(T0);
  });

  it('restore(toProps()) round-trips', () => {
    const result = LedgerEntry.create(props());
    if (result.isErr()) throw new Error('expected Ok');
    const restored = LedgerEntry.restore(result.value.toProps());
    expect(restored.toProps()).toEqual(result.value.toProps());
    expect(restored.equals(result.value)).toBe(true);
  });
});
