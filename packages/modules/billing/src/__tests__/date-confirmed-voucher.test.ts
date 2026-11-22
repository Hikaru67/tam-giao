import { DATE_CONFIRMED } from '@tamgiao/contracts';
import { VOUCHER_TTL_DAYS } from '@tamgiao/contracts/constants';
import { EventBus } from '@tamgiao/db';
import { FakeClock, addDuration, newId, type DomainEvent, type Result } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActivateVoucherOnDateConfirmed } from '../application/voucher/activate-voucher-on-date-confirmed.js';
import { Voucher } from '../domain/voucher.js';
import {
  ACTIVATE_VOUCHER_ON_DATE_CONFIRMED_CONSUMER,
  registerDateConfirmedConsumer,
} from '../infrastructure/date-confirmed-consumer.js';
import { InMemoryBillingStore } from './payment-fakes.js';
import { refundVoucherRepo, seedPaidUser } from './refund-fakes.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const TX = {} as never;

function unwrap<T, E>(r: Result<T, E>): T {
  if (r.isErr()) throw new Error(`expected Ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

let store: InMemoryBillingStore;
let clock: FakeClock;
let useCase: ActivateVoucherOnDateConfirmed;

/** Voucher đã có hạn dùng (hồ sơ được duyệt lúc T0). */
function seedApproved(userId?: string) {
  const seeded = seedPaidUser(store, clock, userId === undefined ? {} : { userId });
  const voucher = Voucher.restore(seeded.voucher.toState());
  unwrap(voucher.setExpiryFromApproval(T0, T0));
  store.vouchers.set(voucher.id, voucher.toState());
  return { userId: seeded.userId, voucherId: voucher.id };
}

beforeEach(() => {
  store = new InMemoryBillingStore();
  clock = new FakeClock(addDuration(T0, { days: 3 }));
  useCase = new ActivateVoucherOnDateConfirmed({ clock, vouchers: refundVoucherRepo(store) });
});

describe('ActivateVoucherOnDateConfirmed (consumer DateConfirmed, BE-S7-01)', () => {
  it('AC2: voucher RESERVED của người mời → ACTIVE + VoucherActivated', async () => {
    const { userId, voucherId } = seedApproved();
    expect(unwrap(await useCase.handle(TX, { userId }))).toEqual({ kind: 'ACTIVATED', voucherId });
    expect(store.vouchers.get(voucherId)).toMatchObject({ status: 'ACTIVE', activatedAt: clock.now() });
    expect(store.events.map((e) => e.type)).toEqual(['VoucherActivated']);
  });

  it('idempotent: chạy lại → ALREADY_ACTIVE, không event mới', async () => {
    const { userId, voucherId } = seedApproved();
    await useCase.handle(TX, { userId });
    expect(unwrap(await useCase.handle(TX, { userId }))).toEqual({ kind: 'ALREADY_ACTIVE', voucherId });
    expect(store.events).toHaveLength(1);
  });

  it('không có voucher mở → NO_VOUCHER', async () => {
    expect(unwrap(await useCase.handle(TX, { userId: newId() }))).toEqual({ kind: 'NO_VOUCHER' });
  });

  it('voucher quá hạn dùng → VOUCHER_EXPIRED (no-op, job hết hạn xử lý)', async () => {
    const { userId, voucherId } = seedApproved();
    clock.set(addDuration(T0, { days: VOUCHER_TTL_DAYS }));
    expect(unwrap(await useCase.handle(TX, { userId }))).toEqual({ kind: 'VOUCHER_EXPIRED', voucherId });
    expect(store.vouchers.get(voucherId)?.status).toBe('RESERVED');
    expect(store.events).toHaveLength(0);
  });

  it('voucher chưa có hạn dùng (KycApproved chưa xử lý) → Err để consumer thử lại', async () => {
    const { userId } = seedPaidUser(store, clock);
    const r = await useCase.handle(TX, { userId });
    expect(r.isErr() && r.error).toMatchObject({
      code: 'VOUCHER_INVALID_TRANSITION',
      details: { reason: 'expiry_not_set' },
    });
  });
});

describe('registerDateConfirmedConsumer', () => {
  const event = (payload: unknown): DomainEvent => ({
    eventId: newId(),
    type: DATE_CONFIRMED,
    aggregateType: 'DatePlan',
    aggregateId: newId(),
    version: 2,
    occurredAt: T0,
    payload,
  });

  it('đăng ký đúng tên consumer; kích hoạt voucher theo inviterId; payload sai / Err → throw', async () => {
    const bus = new EventBus();
    registerDateConfirmedConsumer(bus, useCase);
    const [sub] = bus.list();
    expect(sub && [sub.eventType, sub.consumer]).toEqual([
      DATE_CONFIRMED,
      ACTIVATE_VOUCHER_ON_DATE_CONFIRMED_CONSUMER,
    ]);
    if (!sub) throw new Error('missing consumer');

    const { userId, voucherId } = seedApproved();
    await sub.handler(event({ inviterId: userId, inviteeId: newId() }), TX);
    expect(store.vouchers.get(voucherId)?.status).toBe('ACTIVE');

    await expect(sub.handler(event({ inviteeId: userId }), TX)).rejects.toThrow(/inviterId/);
    const pending = seedPaidUser(store, clock);
    await expect(sub.handler(event({ inviterId: pending.userId }), TX)).rejects.toThrow(
      /VOUCHER_INVALID_TRANSITION/,
    );
  });
});
