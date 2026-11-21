import { VOUCHER_STATUS_VALUES, errorRegistry } from '@tamgiao/contracts';
import { VOUCHER_TTL_DAYS, VOUCHER_VND } from '@tamgiao/contracts/constants';
import { FakeClock, addDuration, newId, type Result } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActivateVoucher } from '../application/voucher/activate-voucher.js';
import { ExpireDueVouchers } from '../application/voucher/expire-due-vouchers.js';
import { RedeemVoucher } from '../application/voucher/redeem-voucher.js';
import { GetVoucherQr, ListMyVouchers } from '../application/voucher/voucher-queries.js';
import type { VerificationPaymentId } from '../domain/verification-payment.js';
import { VOUCHER_STATUSES, Voucher, type VoucherId, type VoucherStatus } from '../domain/voucher.js';
import { VOUCHER_QR_ERRORS, VOUCHER_QR_TOKEN_TTL_SECONDS } from '../domain/voucher-qr.js';
import { deriveVoucherQrKey, HmacVoucherQrTokenService } from '../infrastructure/voucher-qr-token.js';
import { FakeVoucherUnitOfWork, InMemoryVoucherStore } from './voucher-fakes.js';

const T0 = new Date('2026-11-18T01:00:00.000Z');
const APPROVED_AT = new Date('2026-11-10T00:00:00.000Z');
const EXPIRES_AT = addDuration(APPROVED_AT, { days: VOUCHER_TTL_DAYS });
const OWNER = newId<'User'>();
const OTHER_USER = newId<'User'>();
const PARTNER_A = newId<'Partner'>();
const PARTNER_B = newId<'Partner'>();

const unwrap = <T, E>(r: Result<T, E>): T => {
  if (r.isErr()) throw new Error(`expected Ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const errCode = <T, E extends { code: string }>(r: Result<T, E>): string => {
  if (r.isOk()) throw new Error('expected Err');
  return r.error.code;
};

let store: InMemoryVoucherStore;
let uow: FakeVoucherUnitOfWork;
let clock: FakeClock;
const tokens = new HmacVoucherQrTokenService(deriveVoucherQrKey(Buffer.alloc(32, 3)));

beforeEach(() => {
  store = new InMemoryVoucherStore();
  uow = new FakeVoucherUnitOfWork(store);
  clock = new FakeClock(T0);
});

/** Voucher của `userId` ở `status` (đã có hạn = APPROVED_AT + VOUCHER_TTL_DAYS trừ khi `withExpiry: false`). */
function seed(
  status: VoucherStatus,
  opts: {
    userId?: string;
    partnerId?: string | null;
    approvedAt?: Date;
    withExpiry?: boolean;
    issuedAt?: Date;
  } = {},
): Voucher {
  const issuedAt = opts.issuedAt ?? APPROVED_AT;
  const v = Voucher.issue(
    {
      id: newId<'Voucher'>() as VoucherId,
      userId: opts.userId ?? OWNER,
      paymentId: newId<'VerificationPayment'>() as VerificationPaymentId,
      partnerId: opts.partnerId ?? null,
    },
    issuedAt,
  );
  const approvedAt = opts.approvedAt ?? APPROVED_AT;
  if (opts.withExpiry !== false) unwrap(v.setExpiryFromApproval(approvedAt, approvedAt));
  if (status === 'ACTIVE' || status === 'REDEEMED') unwrap(v.activate(approvedAt));
  if (status === 'REDEEMED') unwrap(v.redeem(PARTNER_A, approvedAt));
  if (status === 'VOID') unwrap(v.void('PAYMENT_REFUNDED', approvedAt));
  if (status === 'EXPIRED') unwrap(v.expire(addDuration(approvedAt, { days: VOUCHER_TTL_DAYS })));
  return store.seed(v);
}

describe('contracts voucher (BE-S4-05)', () => {
  it.each(VOUCHER_QR_ERRORS)('%s đã đăng ký HTTP status', (code) => {
    expect(errorRegistry.get(code)).toBeDefined();
  });

  it('HTTP status theo hợp đồng', () => {
    expect(errorRegistry.statusOf('VOUCHER_NOT_FOUND')).toBe(404);
    expect(errorRegistry.statusOf('VOUCHER_TOKEN_INVALID')).toBe(422);
    expect(errorRegistry.statusOf('VOUCHER_ALREADY_REDEEMED')).toBe(409);
  });

  it('trạng thái voucher trong DTO khớp domain', () => {
    expect([...VOUCHER_STATUS_VALUES]).toEqual([...VOUCHER_STATUSES]);
  });
});

describe('ActivateVoucher', () => {
  const activate = () => new ActivateVoucher({ uow, clock, vouchers: store.voucherRepo });

  it('RESERVED có hạn → ACTIVE + event VoucherActivated qua repository', async () => {
    const v = seed('RESERVED');
    const view = unwrap(await activate().execute({ voucherId: v.id }));
    expect(view.status).toBe('ACTIVE');
    expect(store.get(v.id)).toMatchObject({ status: 'ACTIVE', activatedAt: T0 });
    expect(store.events.map((e) => e.type)).toEqual(['VoucherActivated']);
  });

  it('không tồn tại → VOUCHER_NOT_FOUND', async () => {
    expect(errCode(await activate().execute({ voucherId: newId<'Voucher'>() as VoucherId }))).toBe(
      'VOUCHER_NOT_FOUND',
    );
  });

  it('chưa có hạn dùng (hồ sơ chưa duyệt) → VOUCHER_INVALID_TRANSITION, không lưu', async () => {
    const v = seed('RESERVED', { withExpiry: false });
    expect(errCode(await activate().execute({ voucherId: v.id }))).toBe('VOUCHER_INVALID_TRANSITION');
    expect(store.get(v.id).status).toBe('RESERVED');
    expect(store.saves).toBe(0);
  });

  it('đã ACTIVE → VOUCHER_INVALID_TRANSITION; quá hạn → VOUCHER_EXPIRED', async () => {
    expect(errCode(await activate().execute({ voucherId: seed('ACTIVE').id }))).toBe(
      'VOUCHER_INVALID_TRANSITION',
    );
    clock.set(EXPIRES_AT);
    expect(errCode(await activate().execute({ voucherId: seed('RESERVED').id }))).toBe('VOUCHER_EXPIRED');
    expect(store.events).toEqual([]);
  });
});

describe('ListMyVouchers', () => {
  it('chỉ trả voucher của người dùng, mới phát hành trước', async () => {
    const older = seed('ACTIVE', { issuedAt: new Date('2026-11-01T00:00:00.000Z') });
    const newer = seed('RESERVED', { withExpiry: false, issuedAt: new Date('2026-11-05T00:00:00.000Z') });
    seed('ACTIVE', { userId: OTHER_USER });
    const items = await new ListMyVouchers({ uow, vouchers: store.voucherRepo }).execute(OWNER);
    expect(items.map((v) => [v.id, v.status, v.expiresAt])).toEqual([
      [newer.id, 'RESERVED', null],
      [older.id, 'ACTIVE', EXPIRES_AT],
    ]);
    expect(items[0]?.value.amount).toBe(BigInt(VOUCHER_VND));
  });
});

describe('GetVoucherQr', () => {
  const getQr = () => new GetVoucherQr({ uow, clock, vouchers: store.voucherRepo, tokens });

  it('chủ voucher ACTIVE → token hết hạn sau VOUCHER_QR_TOKEN_TTL_SECONDS, verify ra đúng voucher', async () => {
    const v = seed('ACTIVE');
    const qr = unwrap(await getQr().execute({ userId: OWNER, voucherId: v.id }));
    expect(qr.expiresAt).toEqual(new Date(T0.getTime() + VOUCHER_QR_TOKEN_TTL_SECONDS * 1_000));
    expect(unwrap(tokens.verify(qr.token, T0))).toBe(v.id);
  });

  it('voucher của người khác / không tồn tại / id sai định dạng → VOUCHER_NOT_FOUND', async () => {
    const v = seed('ACTIVE');
    for (const cmd of [
      { userId: OTHER_USER, voucherId: v.id },
      { userId: OWNER, voucherId: newId<'Voucher'>() },
      { userId: OWNER, voucherId: 'abc' },
    ]) {
      expect(errCode(await getQr().execute(cmd))).toBe('VOUCHER_NOT_FOUND');
    }
  });

  it.each([
    ['RESERVED', 'VOUCHER_NOT_ACTIVE'],
    ['VOID', 'VOUCHER_NOT_ACTIVE'],
    ['REDEEMED', 'VOUCHER_ALREADY_REDEEMED'],
    ['EXPIRED', 'VOUCHER_EXPIRED'],
  ] as const)('voucher %s → %s', async (status, code) => {
    const v = seed(status);
    expect(errCode(await getQr().execute({ userId: OWNER, voucherId: v.id }))).toBe(code);
  });

  it('ACTIVE nhưng đã quá hạn (job chưa chạy) → VOUCHER_EXPIRED', async () => {
    const v = seed('ACTIVE');
    clock.set(EXPIRES_AT);
    expect(errCode(await getQr().execute({ userId: OWNER, voucherId: v.id }))).toBe('VOUCHER_EXPIRED');
  });
});

describe('RedeemVoucher', () => {
  const redeem = () =>
    new RedeemVoucher({ uow, clock, vouchers: store.voucherRepo, ledger: store.ledgerRepo, tokens });
  const qr = (v: Voucher) => tokens.issue(v.id, clock.now(), VOUCHER_QR_TOKEN_TTL_SECONDS).token;

  it('ACTIVE → REDEEMED + ledger VOUCHER_REDEEM + event VoucherRedeemed', async () => {
    const v = seed('ACTIVE');
    const result = unwrap(await redeem().execute({ token: qr(v), partnerId: PARTNER_A }));
    expect(result).toEqual({ voucherId: v.id, value: v.value, redeemedAt: T0 });
    expect(store.get(v.id)).toMatchObject({
      status: 'REDEEMED',
      redeemedByPartnerId: PARTNER_A,
      redeemedAt: T0,
    });
    expect(store.ledger.map((e) => [e.type, e.amount.amount, e.voucherId, e.paymentId, e.userId])).toEqual([
      ['VOUCHER_REDEEM', BigInt(VOUCHER_VND), v.id, v.paymentId, OWNER],
    ]);
    expect(store.events.map((e) => [e.type, e.payload])).toEqual([
      ['VoucherRedeemed', { voucherId: v.id, userId: OWNER, partnerId: PARTNER_A, valueVnd: VOUCHER_VND }],
    ]);
  });

  it('quét cùng QR lần 2 → VOUCHER_ALREADY_REDEEMED, không thêm ledger/event (AC1)', async () => {
    const v = seed('ACTIVE');
    const token = qr(v);
    unwrap(await redeem().execute({ token, partnerId: PARTNER_A }));
    expect(errCode(await redeem().execute({ token, partnerId: PARTNER_A }))).toBe('VOUCHER_ALREADY_REDEEMED');
    expect(store.ledger).toHaveLength(1);
    expect(store.events).toHaveLength(1);
  });

  it('token bị sửa / hết hạn → VOUCHER_TOKEN_INVALID, không mở transaction (AC2)', async () => {
    const v = seed('ACTIVE');
    const token = qr(v);
    expect(errCode(await redeem().execute({ token: `${token}x`, partnerId: PARTNER_A }))).toBe(
      'VOUCHER_TOKEN_INVALID',
    );
    clock.advance({ seconds: VOUCHER_QR_TOKEN_TTL_SECONDS });
    expect(errCode(await redeem().execute({ token, partnerId: PARTNER_A }))).toBe('VOUCHER_TOKEN_INVALID');
    expect(uow.runs).toBe(0);
    expect(store.get(v.id).status).toBe('ACTIVE');
  });

  it('voucher gắn quán khác → VOUCHER_PARTNER_MISMATCH; đúng quán → được', async () => {
    const v = seed('ACTIVE', { partnerId: PARTNER_A });
    expect(errCode(await redeem().execute({ token: qr(v), partnerId: PARTNER_B }))).toBe(
      'VOUCHER_PARTNER_MISMATCH',
    );
    expect(store.ledger).toEqual([]);
    unwrap(await redeem().execute({ token: qr(v), partnerId: PARTNER_A }));
  });

  it('voucher quá hạn (token còn hạn) → VOUCHER_EXPIRED; sau khi job chạy → vẫn VOUCHER_EXPIRED (AC3)', async () => {
    const v = seed('ACTIVE');
    clock.set(EXPIRES_AT);
    const token = qr(v);
    expect(errCode(await redeem().execute({ token, partnerId: PARTNER_A }))).toBe('VOUCHER_EXPIRED');
    await new ExpireDueVouchers({ uow, clock, vouchers: store.voucherRepo }).execute();
    expect(store.get(v.id).status).toBe('EXPIRED');
    expect(errCode(await redeem().execute({ token, partnerId: PARTNER_A }))).toBe('VOUCHER_EXPIRED');
    expect(store.ledger).toEqual([]);
  });

  it('RESERVED → VOUCHER_NOT_ACTIVE; token hợp lệ nhưng voucher không tồn tại → VOUCHER_NOT_FOUND', async () => {
    expect(errCode(await redeem().execute({ token: qr(seed('RESERVED')), partnerId: PARTNER_A }))).toBe(
      'VOUCHER_NOT_ACTIVE',
    );
    const ghost = tokens.issue(newId<'Voucher'>() as VoucherId, T0, 90).token;
    expect(errCode(await redeem().execute({ token: ghost, partnerId: PARTNER_A }))).toBe('VOUCHER_NOT_FOUND');
  });
});

describe('ExpireDueVouchers (job, FakeClock — AC3)', () => {
  const job = () => new ExpireDueVouchers({ uow, clock, vouchers: store.voucherRepo });

  it('chỉ voucher RESERVED/ACTIVE có expires_at <= now → EXPIRED + VoucherExpired, không ghi ledger', async () => {
    const dueActive = seed('ACTIVE');
    const dueReserved = seed('RESERVED');
    const notDue = seed('ACTIVE', { approvedAt: addDuration(APPROVED_AT, { days: 1 }) });
    const noExpiry = seed('RESERVED', { withExpiry: false });
    const redeemed = seed('REDEEMED');

    clock.set(addDuration(EXPIRES_AT, { seconds: -1 }));
    expect(await job().execute()).toEqual({ expired: 0, batches: 1 });

    clock.set(EXPIRES_AT);
    expect(await job().execute()).toEqual({ expired: 2, batches: 1 });
    expect(store.get(dueActive.id)).toMatchObject({ status: 'EXPIRED', expiredAt: EXPIRES_AT });
    expect(store.get(dueReserved.id).status).toBe('EXPIRED');
    expect(store.get(notDue.id).status).toBe('ACTIVE');
    expect(store.get(noExpiry.id).status).toBe('RESERVED');
    expect(store.get(redeemed.id).status).toBe('REDEEMED');
    expect(store.events.map((e) => e.type)).toEqual(['VoucherExpired', 'VoucherExpired']);
    expect(store.ledger).toEqual([]);
  });

  it('idempotent: chạy lại không đổi gì, không event trùng', async () => {
    seed('ACTIVE');
    clock.set(EXPIRES_AT);
    expect((await job().execute()).expired).toBe(1);
    expect(await job().execute()).toEqual({ expired: 0, batches: 1 });
    expect(store.events).toHaveLength(1);
  });

  it('xử lý theo lô: 5 voucher, lô 2 → 3 transaction, đủ 5', async () => {
    for (let i = 0; i < 5; i++) seed('ACTIVE');
    clock.set(EXPIRES_AT);
    expect(await job().execute({ batchSize: 2 })).toEqual({ expired: 5, batches: 3 });
    expect(uow.runs).toBe(3);
  });

  it('dòng đang bị khoá (SKIP LOCKED) → bỏ qua, lượt sau xử lý', async () => {
    const locked = seed('ACTIVE');
    seed('ACTIVE');
    store.locked.add(locked.id);
    clock.set(EXPIRES_AT);
    expect((await job().execute()).expired).toBe(1);
    expect(store.get(locked.id).status).toBe('ACTIVE');
    store.locked.clear();
    expect((await job().execute()).expired).toBe(1);
    expect(store.get(locked.id).status).toBe('EXPIRED');
  });
});
