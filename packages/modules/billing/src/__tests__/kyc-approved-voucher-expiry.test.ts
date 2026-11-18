import { KYC_APPROVED, KYC_REJECTED } from '@tamgiao/contracts';
import { VOUCHER_TTL_DAYS } from '@tamgiao/contracts/constants';
import { EventBus } from '@tamgiao/db';
import { FakeClock, addDuration, newId, type Result, type DomainEvent } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { SetVoucherExpiryOnKycApproved } from '../application/kyc-approved/set-voucher-expiry-on-kyc-approved.js';
import { RefundOnKycRejected } from '../application/refund/refund-on-kyc-rejected.js';
import {
  REFUND_ON_KYC_REJECTED_CONSUMER,
  SET_VOUCHER_EXPIRY_CONSUMER,
  registerBillingKycConsumers,
} from '../infrastructure/refund-kyc-consumers.js';
import { InMemoryBillingStore } from './payment-fakes.js';
import { refundPaymentRepo, refundVoucherRepo, seedPaidUser } from './refund-fakes.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const TX = {} as never;

function unwrap<T, E>(r: Result<T, E>): T {
  if (r.isErr()) throw new Error(`expected Ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

let store: InMemoryBillingStore;
let clock: FakeClock;
let useCase: SetVoucherExpiryOnKycApproved;

beforeEach(() => {
  store = new InMemoryBillingStore();
  clock = new FakeClock(T0);
  useCase = new SetVoucherExpiryOnKycApproved({ clock, vouchers: refundVoucherRepo(store) });
});

describe('SetVoucherExpiryOnKycApproved (consumer KycApproved)', () => {
  it('voucher RESERVED chưa có hạn → hạn = approvedAt + VOUCHER_TTL_DAYS; updatedAt theo clock', async () => {
    const { userId, voucher } = seedPaidUser(store, clock);
    const approvedAt = addDuration(T0, { hours: 3 });
    clock.set(addDuration(T0, { hours: 4 }));
    const r = await useCase.handle(TX, { userId, approvedAt });
    expect(unwrap(r)).toEqual({ updated: 1 });
    expect(store.vouchers.get(voucher.id)).toMatchObject({
      status: 'RESERVED',
      expiresAt: addDuration(approvedAt, { days: VOUCHER_TTL_DAYS }),
      updatedAt: clock.now(),
    });
  });

  it('idempotent: chạy lại (kể cả approvedAt khác) → bỏ qua, giữ hạn cũ', async () => {
    const { userId, voucher } = seedPaidUser(store, clock);
    await useCase.handle(TX, { userId, approvedAt: T0 });
    const again = await useCase.handle(TX, { userId, approvedAt: addDuration(T0, { days: 1 }) });
    expect(unwrap(again)).toEqual({ updated: 0 });
    expect(store.vouchers.get(voucher.id)?.expiresAt).toEqual(addDuration(T0, { days: VOUCHER_TTL_DAYS }));
  });

  it('không có voucher / voucher đã VOID → không làm gì', async () => {
    expect(unwrap(await useCase.handle(TX, { userId: newId(), approvedAt: T0 }))).toEqual({ updated: 0 });
    const { userId, voucher } = seedPaidUser(store, clock);
    store.vouchers.set(voucher.id, { ...voucher.toState(), status: 'VOID' });
    expect(unwrap(await useCase.handle(TX, { userId, approvedAt: T0 }))).toEqual({ updated: 0 });
  });
});

describe('registerBillingKycConsumers', () => {
  function setup() {
    const bus = new EventBus();
    const payments = refundPaymentRepo(store);
    const vouchers = refundVoucherRepo(store);
    registerBillingKycConsumers(bus, {
      refundOnKycRejected: new RefundOnKycRejected({ clock, payments, vouchers, ledger: store.ledgerRepo }),
      setVoucherExpiry: useCase,
    });
    return bus;
  }

  const event = (type: string, payload: unknown, occurredAt = T0): DomainEvent => ({
    eventId: newId(),
    type,
    aggregateType: 'KycSubmission',
    aggregateId: newId(),
    version: 3,
    occurredAt,
    payload,
  });

  it('đăng ký đúng tên consumer theo loại event', () => {
    const bus = setup();
    expect(bus.consumersOf(KYC_REJECTED).map((s) => s.consumer)).toEqual([REFUND_ON_KYC_REJECTED_CONSUMER]);
    expect(bus.consumersOf(KYC_APPROVED).map((s) => s.consumer)).toEqual([SET_VOUCHER_EXPIRY_CONSUMER]);
  });

  it('KycApproved: hạn voucher tính từ occurredAt của event (không phải giờ xử lý)', async () => {
    const bus = setup();
    const { userId, voucher } = seedPaidUser(store, clock);
    const approvedAt = addDuration(T0, { minutes: -30 });
    const [sub] = bus.consumersOf(KYC_APPROVED);
    await sub?.handler(event(KYC_APPROVED, { submissionId: newId(), userId }, approvedAt), TX);
    expect(store.vouchers.get(voucher.id)?.expiresAt).toEqual(
      addDuration(approvedAt, { days: VOUCHER_TTL_DAYS }),
    );
  });

  it('KycRejected: chuyển REFUND_PENDING; trạng thái bất thường (voucher đã đổi) → throw để rollback/retry', async () => {
    const bus = setup();
    const [sub] = bus.consumersOf(KYC_REJECTED);
    const a = seedPaidUser(store, clock);
    await sub?.handler(
      event(KYC_REJECTED, { submissionId: newId(), userId: a.userId, reasonCode: 'OTHER' }),
      TX,
    );
    expect(store.get(a.payment.id).status).toBe('REFUND_PENDING');

    const b = seedPaidUser(store, clock);
    store.vouchers.set(b.voucher.id, { ...b.voucher.toState(), status: 'REDEEMED' });
    await expect(
      sub?.handler(event(KYC_REJECTED, { submissionId: newId(), userId: b.userId, reasonCode: 'OTHER' }), TX),
    ).rejects.toThrow(/VOUCHER_ALREADY_REDEEMED/);
  });

  it('payload thiếu userId → throw (lỗi lập trình)', async () => {
    const bus = setup();
    const [sub] = bus.consumersOf(KYC_APPROVED);
    await expect(sub?.handler(event(KYC_APPROVED, { submissionId: newId() }), TX)).rejects.toThrow(/userId/);
  });
});
