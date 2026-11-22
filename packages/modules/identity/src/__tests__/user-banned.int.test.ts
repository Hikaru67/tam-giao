import { USER_BANNED, problemSchema, verifyOtpResponseSchema } from '@tamgiao/contracts';
import { DrizzleUnitOfWork, EventBus, HmacBlindIndexer, OutboxWriter, deliverOnce } from '@tamgiao/db';
import { newId, ok, type DomainEvent } from '@tamgiao/kernel';
import { resetDatabase } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserId } from '../domain/user.js';
import { DrizzleUserRepository } from '../infrastructure/drizzle-user-repository.js';
import { IDENTITY_BLOCK_ON_USER_BANNED_CONSUMER, createIdentityWorker } from '../index.js';
import { createIdentityHarness, type IdentityHarness } from './harness.js';

const PHONE = '0912345678';
let h: IdentityHarness;
let uow: DrizzleUnitOfWork;
const bus = new EventBus();

beforeAll(() => {
  h = createIdentityHarness();
  uow = new DrizzleUnitOfWork(h.database.pool);
  createIdentityWorker({ clock: h.clock }).registerConsumers(bus);
});
beforeEach(async () => {
  await resetDatabase(h.database.pool);
  h.sms.sent.length = 0;
});
afterAll(() => h.database.close());

const problemCode = async (res: Response) => problemSchema.parse(await res.json()).code;

async function verify(deviceName: string): Promise<Response> {
  h.clock.advance({ minutes: 5 }); // qua cooldown gửi lại OTP
  await h.post('/auth/otp/request', { phone: PHONE });
  return h.post('/auth/otp/verify', { phone: PHONE, code: h.sms.lastCode(), deviceName });
}

async function login(deviceName = 'iPhone 15') {
  const res = await verify(deviceName);
  expect(res.status).toBe(200);
  return verifyOtpResponseSchema.parse(await res.json());
}

const sessionsWith = (accessToken: string) =>
  h.app.request('/auth/sessions', { headers: { authorization: `Bearer ${accessToken}` } });

async function deleteAccount(token: string) {
  h.clock.advance({ minutes: 5 });
  const otp = await h.app.request('/me/account/deletion/otp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.7' },
  });
  expect(otp.status).toBe(200);
  return h.post('/me/account/deletion', { code: h.sms.lastCode() }, { authorization: `Bearer ${token}` });
}

const userBanned = (userId: string): DomainEvent => ({
  eventId: newId(),
  type: USER_BANNED,
  aggregateType: 'UserBan',
  aggregateId: newId(),
  version: 1,
  occurredAt: h.clock.now(),
  payload: { banId: newId(), userId, bannedBy: newId(), reportId: null },
});

const consumer = () => {
  const sub = bus.list().find((s) => s.consumer === IDENTITY_BLOCK_ON_USER_BANNED_CONSUMER);
  if (!sub) throw new Error('consumer chưa đăng ký');
  return sub;
};

describe('UserBanned → identity (BE-S6-06)', () => {
  it('AC1: mọi phiên bị thu hồi — access token 401, refresh token 401; đăng nhập lại → 403 ACCOUNT_BANNED', async () => {
    const phone = await login('iPhone');
    const tablet = await login('iPad');
    expect((await sessionsWith(phone.tokens.accessToken)).status).toBe(200);

    const event = userBanned(phone.userId);
    expect(await deliverOnce(uow, consumer(), event)).toBe(true);

    for (const t of [phone.tokens, tablet.tokens]) {
      const res = await sessionsWith(t.accessToken);
      expect(res.status).toBe(401);
      const refreshed = await h.post('/auth/refresh', { refreshToken: t.refreshToken });
      expect(refreshed.status).toBe(401);
    }
    const { rows } = await h.database.pool.query<{ revoke_reason: string }>(
      'select revoke_reason from identity.sessions order by created_at',
    );
    expect(rows.map((r) => r.revoke_reason)).toEqual(['USER_BANNED', 'USER_BANNED']);

    const again = await verify('Pixel');
    expect(again.status).toBe(403);
    expect(await problemCode(again)).toBe('ACCOUNT_BANNED');
    const count = await h.database.pool.query('select id from identity.sessions');
    expect(count.rows).toHaveLength(2);

    // Giao lại cùng event → bỏ qua; event mới cùng user → idempotent.
    expect(await deliverOnce(uow, consumer(), event)).toBe(false);
    expect(await deliverOnce(uow, consumer(), userBanned(phone.userId))).toBe(true);
    const banned = await h.database.pool.query('select user_id from identity.banned_users');
    expect(banned.rows).toEqual([{ user_id: phone.userId }]);
  });

  it('bị khoá rồi xoá tài khoản → lưu blind index vào deleted_phone_indexes; đăng ký lại trả 403 ACCOUNT_BANNED', async () => {
    const phone = await login();
    const {
      rows: [initialUser],
    } = await h.database.pool.query<{ phone_bidx: string }>(
      'select phone_bidx from identity.users where id = $1',
      [phone.userId],
    );
    expect(initialUser).toBeDefined();

    // Bị khoá
    const event = userBanned(phone.userId);
    expect(await deliverOnce(uow, consumer(), event)).toBe(true);

    // Xoá tài khoản (gọi anonymize trong uow)
    const userRepo = new DrizzleUserRepository(
      h.encryptor,
      new HmacBlindIndexer(Buffer.alloc(32, 9)),
      new OutboxWriter(),
    );
    await uow.run(async (tx) => {
      await userRepo.anonymize(tx, phone.userId as UserId, h.clock.now());
      return ok();
    });

    // identity.deleted_phone_indexes có dòng
    const { rows: deletedRows } = await h.database.pool.query<{ user_id: string; phone_bidx: string }>(
      'select user_id, phone_bidx from identity.deleted_phone_indexes where user_id = $1',
      [phone.userId],
    );
    expect(deletedRows).toEqual([{ user_id: phone.userId, phone_bidx: initialUser?.phone_bidx }]);

    // Đăng ký lại cùng SĐT → 403 ACCOUNT_BANNED
    const again = await verify('Pixel');
    expect(again.status).toBe(403);
    expect(await problemCode(again)).toBe('ACCOUNT_BANNED');

    // Không có dòng identity.users mới cho SĐT đó
    const { rows: users } = await h.database.pool.query('select id from identity.users');
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe(phone.userId);
  });

  it('xoá tài khoản rồi mới bị khoá (giao UserBanned sau) → đăng ký lại trả 403 ACCOUNT_BANNED', async () => {
    const phone = await login();
    const res = await deleteAccount(phone.tokens.accessToken);
    expect(res.status).toBe(202);

    // Giao UserBanned sau khi xoá
    const event = userBanned(phone.userId);
    expect(await deliverOnce(uow, consumer(), event)).toBe(true);

    // Đăng ký lại cùng SĐT → 403 ACCOUNT_BANNED
    const again = await verify('Pixel');
    expect(again.status).toBe(403);
    expect(await problemCode(again)).toBe('ACCOUNT_BANNED');
  });

  it('xoá tài khoản không bị khoá → đăng ký lại thành công với user id mới', async () => {
    const phone = await login();
    const res = await deleteAccount(phone.tokens.accessToken);
    expect(res.status).toBe(202);

    // Đăng ký lại cùng SĐT → thành công
    const again = await login('Pixel');
    expect(again.isNewUser).toBe(true);
    expect(again.userId).not.toBe(phone.userId);
  });

  it('anonymize chạy 2 lần → vẫn đúng 1 dòng deleted_phone_indexes', async () => {
    const phone = await login();
    const userRepo = new DrizzleUserRepository(
      h.encryptor,
      new HmacBlindIndexer(Buffer.alloc(32, 9)),
      new OutboxWriter(),
    );

    await uow.run(async (tx) => {
      await userRepo.anonymize(tx, phone.userId as UserId, h.clock.now());
      return ok();
    });

    await uow.run(async (tx) => {
      await userRepo.anonymize(tx, phone.userId as UserId, h.clock.now());
      return ok();
    });

    const { rows } = await h.database.pool.query(
      'select user_id from identity.deleted_phone_indexes where user_id = $1',
      [phone.userId],
    );
    expect(rows).toHaveLength(1);
  });
});
