import {
  ACCOUNT_DELETION_REQUESTED,
  DATA_EXPORT_REQUESTED,
  accountDeletionViewSchema,
  dataExportDocumentSchema,
  dataExportViewSchema,
  problemSchema,
  verifyOtpResponseSchema,
} from '@tamgiao/contracts';
import { DrizzleUnitOfWork, EventBus, deliverOnce } from '@tamgiao/db';
import { newId, type DomainEvent } from '@tamgiao/kernel';
import { resetDatabase, runConcurrently } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_BUILD_DATA_EXPORT_CONSUMER,
  createDataExportPurgeJob,
  createIdentityWorker,
} from '../index.js';
import { HARNESS_DELETION_STEPS, createIdentityHarness, type IdentityHarness } from './harness.js';

const PHONE = '0912345678';
let h: IdentityHarness;
let uow: DrizzleUnitOfWork;
const bus = new EventBus();

beforeAll(() => {
  h = createIdentityHarness();
  uow = new DrizzleUnitOfWork(h.database.pool);
  createIdentityWorker({
    clock: h.clock,
    dataExport: { encryptor: h.encryptor, sources: [] },
  }).registerConsumers(bus);
});
beforeEach(async () => {
  await resetDatabase(h.database.pool);
  h.sms.sent.length = 0;
});
afterAll(() => h.database.close());

const sql = async <T extends object>(text: string, params: unknown[] = []): Promise<T[]> =>
  (await h.database.pool.query<T>(text, params)).rows;
const problemCode = async (res: Response) => problemSchema.parse(await res.json()).code;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (path: string, token?: string) => h.app.request(path, { headers: token ? auth(token) : {} });

async function login(phone = PHONE) {
  h.clock.advance({ minutes: 5 });
  await h.post('/auth/otp/request', { phone });
  const res = await h.post('/auth/otp/verify', { phone, code: h.sms.lastCode(), deviceName: 'iPhone' });
  return { res, body: res.status === 200 ? verifyOtpResponseSchema.parse(await res.json()) : null };
}

async function loggedIn(phone = PHONE) {
  const { body } = await login(phone);
  if (!body) throw new Error('đăng nhập thất bại');
  return body;
}

const consumer = (name: string) => {
  const sub = bus.list().find((s) => s.consumer === name);
  if (!sub) throw new Error(`consumer ${name} chưa đăng ký`);
  return sub;
};

async function outboxEvent(type: string): Promise<DomainEvent> {
  const [row] = await sql<{
    id: string;
    aggregate_type: string;
    aggregate_id: string;
    aggregate_version: number;
    payload: unknown;
    occurred_at: Date;
  }>(`select * from platform.outbox where event_type = $1 order by created_at desc limit 1`, [type]);
  if (!row) throw new Error(`không có event ${type}`);
  return {
    eventId: row.id,
    type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    version: row.aggregate_version,
    occurredAt: row.occurred_at,
    payload: row.payload,
  };
}

async function deleteAccount(token: string) {
  h.clock.advance({ minutes: 5 });
  const otp = await h.app.request('/me/account/deletion/otp', {
    method: 'POST',
    headers: { ...auth(token), 'x-forwarded-for': '203.0.113.7' },
  });
  expect(otp.status).toBe(200);
  return h.post('/me/account/deletion', { code: h.sms.lastCode() }, auth(token));
}

describe('Xuất dữ liệu cá nhân — HTTP (BE-S7-06)', () => {
  it('AC2: POST 202 → worker dựng → GET READY + link; link tải JSON mục account chỉ của chính chủ', async () => {
    const me = await loggedIn();
    await loggedIn('0987654321'); // người khác — không được lọt vào file

    const created = await h.app.request('/me/data-exports', {
      method: 'POST',
      headers: auth(me.tokens.accessToken),
    });
    expect(created.status).toBe(202);
    const pending = dataExportViewSchema.parse(await created.json());
    expect(pending).toMatchObject({ status: 'PENDING', downloadUrl: null });
    const again = await h.app.request('/me/data-exports', {
      method: 'POST',
      headers: auth(me.tokens.accessToken),
    });
    expect(again.status).toBe(200);
    expect(dataExportViewSchema.parse(await again.json()).exportId).toBe(pending.exportId);

    expect(
      await deliverOnce(
        uow,
        consumer(IDENTITY_BUILD_DATA_EXPORT_CONSUMER),
        await outboxEvent(DATA_EXPORT_REQUESTED),
      ),
    ).toBe(true);
    const [stored] = await sql<{ payload_enc: Buffer }>('select payload_enc from identity.data_exports');
    expect(stored?.payload_enc.toString('utf8')).not.toContain('+84912345678'); // nội dung mã hoá

    const view = dataExportViewSchema.parse(
      await (await get(`/me/data-exports/${pending.exportId}`, me.tokens.accessToken)).json(),
    );
    expect(view.status).toBe('READY');
    expect(new Date(view.expiresAt ?? 0).getTime() - new Date(view.readyAt ?? 0).getTime()).toBe(
      24 * 3600_000,
    );

    const download = await get(view.downloadUrl ?? '');
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    const doc = dataExportDocumentSchema.parse(await download.json());
    expect(doc.userId).toBe(me.userId);
    expect(doc.sections.account).toMatchObject({ userId: me.userId, phone: '+84912345678' });
    expect(JSON.stringify(doc)).not.toContain('+84987654321');
  });

  it('link bị sửa → 403; người khác xem → 404; quá 24h → 410 và job purge xoá nội dung', async () => {
    const me = await loggedIn();
    const other = await loggedIn('0987654321');
    const created = dataExportViewSchema.parse(
      await (
        await h.app.request('/me/data-exports', { method: 'POST', headers: auth(me.tokens.accessToken) })
      ).json(),
    );
    await deliverOnce(
      uow,
      consumer(IDENTITY_BUILD_DATA_EXPORT_CONSUMER),
      await outboxEvent(DATA_EXPORT_REQUESTED),
    );
    const view = dataExportViewSchema.parse(
      await (await get(`/me/data-exports/${created.exportId}`, me.tokens.accessToken)).json(),
    );
    const url = view.downloadUrl ?? '';

    const tampered = await get(url.replace(/sig=[^&]+/, 'sig=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'));
    expect(tampered.status).toBe(403);
    expect(await problemCode(tampered)).toBe('DATA_EXPORT_LINK_INVALID');
    const foreign = await get(`/me/data-exports/${created.exportId}`, other.tokens.accessToken);
    expect(foreign.status).toBe(404);

    h.clock.advance({ hours: 24 });
    const late = await get(url);
    expect(late.status).toBe(410);
    expect(await problemCode(late)).toBe('DATA_EXPORT_EXPIRED');
    const purge = createDataExportPurgeJob({ uow, clock: h.clock, encryptor: h.encryptor });
    expect(await purge.execute()).toBe(1);
    expect(await sql('select id from identity.data_exports where payload_enc is not null')).toEqual([]);
    expect(await purge.execute()).toBe(0);
  });

  it('A10: nhiều request đồng thời → đúng một yêu cầu PENDING', async () => {
    const me = await loggedIn();
    const results = await runConcurrently(5, async () =>
      h.app.request('/me/data-exports', { method: 'POST', headers: auth(me.tokens.accessToken) }),
    );
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    expect(statuses.filter((s) => s === 202)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(4);
    expect(await sql('select id from identity.data_exports')).toHaveLength(1);
    expect(
      await sql(`select id from platform.outbox where event_type = $1`, [DATA_EXPORT_REQUESTED]),
    ).toHaveLength(1);
  });
});

describe('Xoá tài khoản — HTTP (BE-S7-06)', () => {
  it('OTP đúng → 202 + event; phiên bị thu hồi; SĐT không còn trong identity; đăng ký lại = tài khoản mới', async () => {
    const me = await loggedIn();
    const res = await deleteAccount(me.tokens.accessToken);
    expect(res.status).toBe(202);
    const view = accountDeletionViewSchema.parse(await res.json());
    expect(view).toMatchObject({ status: 'PROCESSING', steps: [{ module: 'profile', done: false }] });

    const event = await outboxEvent(ACCOUNT_DELETION_REQUESTED);
    expect(event.payload).toEqual({
      requestId: view.requestId,
      userId: me.userId,
      requestedAt: view.requestedAt,
    });

    expect((await get('/auth/sessions', me.tokens.accessToken)).status).toBe(401);
    expect((await h.post('/auth/refresh', { refreshToken: me.tokens.refreshToken })).status).toBe(401);
    const [user] = await sql<{ phone_enc: Buffer; phone_bidx: string; deleted_at: Date | null }>(
      'select phone_enc, phone_bidx, deleted_at from identity.users where id = $1',
      [me.userId],
    );
    expect(user?.phone_enc.length).toBe(0);
    expect(user?.phone_bidx).toBe(`deleted:${me.userId}`);
    expect(user?.deleted_at).not.toBeNull();
    const audit = await sql<{ action: string; meta: unknown }>(
      'select action, meta from identity.audit_logs',
    );
    expect(audit).toEqual([{ action: 'identity.account_delete', meta: { requestId: view.requestId } }]);

    const again = await loggedIn();
    expect(again.isNewUser).toBe(true);
    expect(again.userId).not.toBe(me.userId);

    // Tiến độ: chưa module nào xử lý → PROCESSING; consumer ghi processed_events → COMPLETED.
    const status = async () =>
      accountDeletionViewSchema.parse(await (await get(`/account-deletions/${view.requestId}`)).json());
    expect((await status()).status).toBe('PROCESSING');
    await sql('insert into platform.processed_events (consumer, event_id) values ($1, $2)', [
      HARNESS_DELETION_STEPS[0]?.consumer,
      event.eventId,
    ]);
    expect(await status()).toMatchObject({ status: 'COMPLETED', steps: [{ module: 'profile', done: true }] });
    expect((await get(`/account-deletions/${newId()}`)).status).toBe(404);
  });

  it('OTP sai → 422 OTP_INVALID, tài khoản còn nguyên; mã đăng nhập không xoá được', async () => {
    const me = await loggedIn();
    const loginCode = h.sms.lastCode();
    const res = await h.post('/me/account/deletion', { code: loginCode }, auth(me.tokens.accessToken));
    expect(res.status).toBe(422);
    expect(await problemCode(res)).toBe('OTP_INVALID');
    expect((await get('/auth/sessions', me.tokens.accessToken)).status).toBe(200);
    expect(await sql('select id from identity.account_deletions')).toEqual([]);
  });
});
