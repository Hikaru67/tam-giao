import { OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS } from '@tamgiao/contracts/constants';
import { FakeClock } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { PHONE_INDEX_PURPOSE } from '../application/index-purposes.js';
import { SessionIssuer } from '../application/session-issuer.js';
import { RequestOtp } from '../application/use-cases/request-otp.js';
import { VerifyOtp } from '../application/use-cases/verify-otp.js';
import {
  FakeBlindIndexer,
  InMemoryBannedUserRegistry,
  FakeOtpSecrets,
  FakeUnitOfWork,
  InMemoryOtpChallengeRepository,
  InMemoryRateLimiter,
  InMemorySessionRepository,
  InMemoryUserRepository,
  FakeAccessTokenService,
  FakeRefreshTokenSecrets,
  RecordingSmsSender,
} from './fakes.js';

const PHONE = '0912345678';
const IP = '203.0.113.7';

function setup() {
  const clock = new FakeClock(new Date('2026-11-16T08:00:00.000Z'));
  const challenges = new InMemoryOtpChallengeRepository();
  const users = new InMemoryUserRepository();
  const rateLimiter = new InMemoryRateLimiter();
  const sms = new RecordingSmsSender();
  const otpSecrets = new FakeOtpSecrets();
  const blindIndexer = new FakeBlindIndexer();
  const sessions = new InMemorySessionRepository();
  const issuer = new SessionIssuer(sessions, new FakeAccessTokenService(), new FakeRefreshTokenSecrets());
  const bannedUsers = new InMemoryBannedUserRegistry();
  const uow = new FakeUnitOfWork([
    challenges.table,
    users.table,
    users.events,
    rateLimiter.table,
    sessions.table,
    sessions.tokens,
  ]);
  const requestOtp = new RequestOtp({ uow, clock, challenges, rateLimiter, otpSecrets, sms, blindIndexer });
  const verifyOtp = new VerifyOtp({
    uow,
    clock,
    challenges,
    users,
    otpSecrets,
    blindIndexer,
    issuer,
    bannedUsers,
  });
  return { clock, challenges, users, sessions, sms, bannedUsers, blindIndexer, requestOtp, verifyOtp };
}

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

const errorOf = (r: { isErr(): boolean; error?: { code: string; details?: unknown } }) =>
  r.isErr() ? r.error : undefined;

describe('RequestOtp', () => {
  it('gửi SMS chứa mã 6 số tới SĐT đã chuẩn hoá và trả thời hạn', async () => {
    const result = await t.requestOtp.execute({ phone: PHONE, ip: IP });
    expect(result.isOk() && result.value).toEqual({
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: 60,
    });
    expect(t.sms.sent).toHaveLength(1);
    expect(t.sms.sent[0]?.to).toBe('+84912345678');
    expect(t.sms.lastCode()).toMatch(/^\d{6}$/);
  });

  it('chỉ lưu hash của mã, không lưu mã hay SĐT thô', async () => {
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const [state] = [...t.challenges.table.rows.values()];
    const stored = JSON.stringify(state);
    expect(state?.codeHash).not.toBe(t.sms.lastCode());
    expect(stored).not.toContain('"000000"');
    expect(state?.phoneIndex).toBe('identity.phone|+84912345678');
  });

  it('SĐT sai → PHONE_INVALID, không gửi SMS', async () => {
    const result = await t.requestOtp.execute({ phone: '12345', ip: IP });
    expect(errorOf(result)?.code).toBe('PHONE_INVALID');
    expect(t.sms.sent).toHaveLength(0);
  });

  it('gọi lại trong 60s → RATE_LIMITED kèm thời gian chờ, không đổi OTP đang hiệu lực (AC3)', async () => {
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const firstCode = t.sms.lastCode();
    t.clock.advance({ seconds: 20 });

    const again = await t.requestOtp.execute({ phone: PHONE, ip: IP });
    expect(errorOf(again)).toEqual({ code: 'RATE_LIMITED', details: { retryAfterSeconds: 40 } });
    expect(t.sms.sent).toHaveLength(1);

    const verified = await t.verifyOtp.execute({ phone: PHONE, code: firstCode });
    expect(verified.isOk()).toBe(true);
  });

  it('quá 5 OTP/giờ cho một SĐT → RATE_LIMITED tới khi lượt cũ nhất ra khỏi cửa sổ (AC3)', async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await t.requestOtp.execute({ phone: PHONE, ip: `203.0.113.${i}` });
      expect(ok.isOk()).toBe(true);
      t.clock.advance({ seconds: 61 });
    }
    // 5 lượt ở giây 0, 61, 122, 183, 244; hiện tại = 305 → lượt đầu rời cửa sổ ở giây 3600.
    const sixth = await t.requestOtp.execute({ phone: PHONE, ip: '203.0.113.99' });
    expect(errorOf(sixth)).toEqual({ code: 'RATE_LIMITED', details: { retryAfterSeconds: 3_600 - 305 } });

    t.clock.advance({ seconds: 3_600 - 305 });
    expect((await t.requestOtp.execute({ phone: PHONE, ip: '203.0.113.99' })).isOk()).toBe(true);
  });

  it('giới hạn theo IP độc lập với SĐT; bị chặn ở IP thì lượt của SĐT không bị trừ (AC3)', async () => {
    await t.requestOtp.execute({ phone: '0912345678', ip: IP });
    const other = await t.requestOtp.execute({ phone: '0987654321', ip: IP });
    expect(errorOf(other)?.code).toBe('RATE_LIMITED');
    // SĐT thứ hai chưa bị tính lượt → đổi IP là gửi được ngay.
    expect((await t.requestOtp.execute({ phone: '0987654321', ip: '198.51.100.1' })).isOk()).toBe(true);
  });

  it('yêu cầu mới thay thế OTP cũ', async () => {
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const oldCode = t.sms.lastCode();
    t.clock.advance({ seconds: 61 });
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const newCode = t.sms.lastCode();

    expect(errorOf(await t.verifyOtp.execute({ phone: PHONE, code: oldCode }))?.code).toBe('OTP_INVALID');
    expect((await t.verifyOtp.execute({ phone: PHONE, code: newCode })).isOk()).toBe(true);
  });

  it('gửi SMS lỗi → throw (lỗi hạ tầng)', async () => {
    t.sms.failNext = true;
    await expect(t.requestOtp.execute({ phone: PHONE, ip: IP })).rejects.toThrow('sms gateway down');
  });
});

describe('VerifyOtp', () => {
  it('tài khoản đã bị khoá (BE-S6-06) → ACCOUNT_BANNED, OTP bị tiêu thụ, không mở phiên', async () => {
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const first = await t.verifyOtp.execute({ phone: PHONE, code: t.sms.lastCode() });
    const userId = first.isOk() ? first.value.userId : '';
    await t.bannedUsers.markBanned({} as never, userId, t.clock.now());

    t.clock.advance({ minutes: 5 });
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const code = t.sms.lastCode();
    expect(errorOf(await t.verifyOtp.execute({ phone: PHONE, code }))?.code).toBe('ACCOUNT_BANNED');
    expect(t.sessions.table.rows.size).toBe(1);
    expect(errorOf(await t.verifyOtp.execute({ phone: PHONE, code }))?.code).toBe('OTP_INVALID');
  });

  it('mã đúng lần đầu → tạo User + phát UserRegistered không chứa SĐT (AC1)', async () => {
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const result = await t.verifyOtp.execute({ phone: '+84 912 345 678', code: t.sms.lastCode() });

    expect(result.isOk() && result.value.isNewUser).toBe(true);
    const userId = result.isOk() ? result.value.userId : '';
    expect([...t.users.table.rows.keys()]).toEqual([userId]);
    const events = [...t.users.events.rows.values()];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'UserRegistered',
      aggregateType: 'User',
      aggregateId: userId,
      version: 1,
      payload: { userId },
    });
    expect(JSON.stringify(events[0])).not.toContain('912345678');
  });

  it('OTP bị vô hiệu sau khi dùng (AC1)', async () => {
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const code = t.sms.lastCode();
    expect((await t.verifyOtp.execute({ phone: PHONE, code })).isOk()).toBe(true);
    expect(errorOf(await t.verifyOtp.execute({ phone: PHONE, code }))?.code).toBe('OTP_INVALID');
  });

  it('đăng nhập lại bằng SĐT đã có → cùng userId, không tạo user/event mới', async () => {
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const first = await t.verifyOtp.execute({ phone: PHONE, code: t.sms.lastCode() });
    t.clock.advance({ minutes: 5 });
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const second = await t.verifyOtp.execute({ phone: PHONE, code: t.sms.lastCode() });

    expect(second.isOk() && second.value).toMatchObject({
      userId: first.isOk() ? first.value.userId : '',
      isNewUser: false,
    });
    // Mỗi lần đăng nhập mở một phiên (thiết bị) riêng.
    expect(t.sessions.table.rows.size).toBe(2);
    expect(t.users.table.rows.size).toBe(1);
    expect(t.users.events.rows.size).toBe(1);
  });

  it('hết TTL → OTP_EXPIRED (AC2)', async () => {
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    t.clock.advance({ seconds: OTP_TTL_SECONDS });
    const result = await t.verifyOtp.execute({ phone: PHONE, code: t.sms.lastCode() });
    expect(errorOf(result)?.code).toBe('OTP_EXPIRED');
    expect(t.users.table.rows.size).toBe(0);
  });

  it('lần sai được lưu lại; sai đủ OTP_MAX_ATTEMPTS lần → OTP_LOCKED, mã đúng cũng không qua (AC2)', async () => {
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const code = t.sms.lastCode();
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      const wrong = await t.verifyOtp.execute({ phone: PHONE, code: '999999' });
      expect(errorOf(wrong)).toEqual({
        code: 'OTP_INVALID',
        details: { remainingAttempts: OTP_MAX_ATTEMPTS - i },
      });
    }
    expect(errorOf(await t.verifyOtp.execute({ phone: PHONE, code: '999999' }))?.code).toBe('OTP_LOCKED');
    expect(errorOf(await t.verifyOtp.execute({ phone: PHONE, code }))?.code).toBe('OTP_LOCKED');
    expect(t.users.table.rows.size).toBe(0);
  });

  it('chưa từng yêu cầu OTP hoặc SĐT sai', async () => {
    expect(errorOf(await t.verifyOtp.execute({ phone: PHONE, code: '123456' }))?.code).toBe('OTP_INVALID');
    expect(errorOf(await t.verifyOtp.execute({ phone: 'abc', code: '123456' }))?.code).toBe('PHONE_INVALID');
  });

  it('OTP của SĐT này không dùng được cho SĐT khác', async () => {
    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    await t.requestOtp.execute({ phone: '0987654321', ip: '198.51.100.1' });
    const [codeA] = t.sms.sent.map((m) => /\d{6}/.exec(m.text)?.[0] ?? '');
    const result = await t.verifyOtp.execute({ phone: '0987654321', code: codeA ?? '' });
    expect(errorOf(result)?.code).toBe('OTP_INVALID');
  });

  it('SĐT có trong deletedPhones và userId đó bị khoá → ACCOUNT_BANNED, không tạo user mới, không mở phiên', async () => {
    const oldUserId = 'old-user-id';
    const phoneBidx = t.blindIndexer.index('+84912345678', PHONE_INDEX_PURPOSE);
    t.bannedUsers.deletedPhones.set(phoneBidx, oldUserId);
    await t.bannedUsers.markBanned({} as never, oldUserId, t.clock.now());

    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const code = t.sms.lastCode();
    const result = await t.verifyOtp.execute({ phone: PHONE, code });

    expect(errorOf(result)?.code).toBe('ACCOUNT_BANNED');
    expect(t.users.table.rows.size).toBe(0);
    expect(t.sessions.table.rows.size).toBe(0);
  });

  it('SĐT có trong deletedPhones nhưng userId KHÔNG bị khoá → đăng ký mới thành công (isNewUser: true)', async () => {
    const oldUserId = 'old-user-id';
    const phoneBidx = t.blindIndexer.index('+84912345678', PHONE_INDEX_PURPOSE);
    t.bannedUsers.deletedPhones.set(phoneBidx, oldUserId);

    await t.requestOtp.execute({ phone: PHONE, ip: IP });
    const code = t.sms.lastCode();
    const result = await t.verifyOtp.execute({ phone: PHONE, code });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.isNewUser).toBe(true);
      expect(result.value.userId).not.toBe(oldUserId);
    }
    expect(t.users.table.rows.size).toBe(1);
    expect(t.sessions.table.rows.size).toBe(1);
  });
});
