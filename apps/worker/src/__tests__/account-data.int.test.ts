import { createLogger } from '@tamgiao/config';
import {
  ACCOUNT_DELETION_REQUESTED,
  DATA_EXPORT_REQUESTED,
  MATCH_LOCKED,
  accountDeletionViewSchema,
  dataExportDocumentSchema,
  dataExportViewSchema,
  verifyOtpResponseSchema,
} from '@tamgiao/contracts';
import {
  DrizzleUnitOfWork,
  EventBus,
  HmacBlindIndexer,
  LocalKeyEncryptor,
  UPLOADS_ERASE_ON_ACCOUNT_DELETION_CONSUMER,
  createDatabase,
  deliverOnce,
  type Database,
} from '@tamgiao/db';
import { handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import { FakeClock, addDuration, newId, ok, type DomainEvent, type ObjectStorage } from '@tamgiao/kernel';
import { BILLING_ERASE_ON_ACCOUNT_DELETION_CONSUMER } from '@tamgiao/module-billing';
import {
  IDENTITY_BUILD_DATA_EXPORT_CONSUMER,
  createIdentityModule,
  createIdentityWorker,
  type AccountDeletionStep,
} from '@tamgiao/module-identity';
import { MATCH_ERASE_ON_ACCOUNT_DELETION_CONSUMER, createMatchingWorker } from '@tamgiao/module-matching';
import {
  MESSAGING_ERASE_ON_ACCOUNT_DELETION_CONSUMER,
  createMessagingWorker,
} from '@tamgiao/module-messaging';
import { NOTIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER } from '@tamgiao/module-notification';
import { PROFILE_ERASE_ON_ACCOUNT_DELETION_CONSUMER } from '@tamgiao/module-profile';
import { SAFETY_ERASE_ON_ACCOUNT_DELETION_CONSUMER } from '@tamgiao/module-safety';
import { VERIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER } from '@tamgiao/module-verification';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { personalDataSources, registerAccountDeletionConsumers } from '../data-rights.js';

/**
 * BE-S7-06 — test tích hợp xuyên module: dữ liệu thật ở mọi schema (profile, verification, billing, matching, messaging,
 * safety, platform.uploads) → xuất dữ liệu (AC2) → xoá tài khoản qua HTTP identity → giao `AccountDeletionRequested` tới
 * consumer của từng module (đúng wiring của worker) → kiểm tra từng schema (AC1).
 */

/** Giống `ACCOUNT_DELETION_STEPS` của apps/api (API báo tiến độ theo danh sách này). */
const STEPS: readonly AccountDeletionStep[] = [
  { module: 'profile', consumer: PROFILE_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'verification', consumer: VERIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'billing', consumer: BILLING_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'matching', consumer: MATCH_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'messaging', consumer: MESSAGING_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'safety', consumer: SAFETY_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'notification', consumer: NOTIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
  { module: 'uploads', consumer: UPLOADS_ERASE_ON_ACCOUNT_DELETION_CONSUMER },
];

const NOW = new Date('2026-11-20T08:00:00.000Z');
const clock = new FakeClock(NOW);
const encryptor = new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
const deletedObjects: string[] = [];
const storage: ObjectStorage = {
  presignPut: async () => {
    throw new Error('không dùng');
  },
  presignGet: async ({ bucket, key }) => ({
    url: `https://storage.test/${bucket}/${key}`,
    method: 'GET',
    headers: {},
    expiresAt: addDuration(clock.now(), { minutes: 5 }),
  }),
  head: async () => null,
  delete: async (bucket, key) => void deletedObjects.push(`${bucket}/${key}`),
};
const smsTexts: string[] = [];
const lastCode = () => /\b(\d{6})\b/.exec(smsTexts.at(-1) ?? '')?.[1] ?? '';

let database: Database;
let uow: DrizzleUnitOfWork;
let app: Hono<AppEnv>;
const bus = new EventBus();

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  const identity = createIdentityModule({
    uow,
    clock,
    encryptor,
    blindIndexer: new HmacBlindIndexer(Buffer.alloc(32, 9)),
    smsSender: { send: async (m) => void smsTexts.push(m.text) },
    authSecret: Buffer.alloc(32, 11),
    dataRights: { storage, accountDeletionSteps: STEPS },
  });
  app = new Hono<AppEnv>();
  app.use('*', requestContext(createLogger({ service: 'api', level: 'silent' }), { trustProxy: true }));
  app.route('/', identity.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);

  // Wiring y như apps/worker/src/main.ts.
  createMatchingWorker({
    clock,
    profiles: { getMatchingProfile: async () => null },
    scheduler: { schedule: async () => undefined },
  }).registerConsumers(bus);
  createMessagingWorker({ clock }).registerConsumers(bus);
  createIdentityWorker({
    clock,
    dataExport: { encryptor, sources: personalDataSources({ encryptor }) },
  }).registerConsumers(bus);
  registerAccountDeletionConsumers(bus, { clock, encryptor, storage });
});
beforeEach(async () => {
  await resetDatabase(database.pool);
  deletedObjects.length = 0;
  smsTexts.length = 0;
  clock.set(NOW);
});
afterAll(() => database.close());

const sql = async <T extends object = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> => (await database.pool.query<T>(text, params)).rows;

const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.7',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
const get = (path: string, token?: string) =>
  app.request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

async function login(phone: string) {
  clock.advance({ minutes: 5 });
  await post('/auth/otp/request', { phone });
  const res = await post('/auth/otp/verify', { phone, code: lastCode() });
  expect(res.status).toBe(200);
  return verifyOtpResponseSchema.parse(await res.json());
}

async function outboxEvents(type: string): Promise<DomainEvent[]> {
  const rows = await sql<{
    id: string;
    aggregate_type: string;
    aggregate_id: string;
    aggregate_version: number;
    payload: unknown;
    occurred_at: Date;
  }>('select * from platform.outbox where event_type = $1 order by created_at', [type]);
  return rows.map((r) => ({
    eventId: r.id,
    type,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    version: r.aggregate_version,
    occurredAt: r.occurred_at,
    payload: r.payload,
  }));
}

const subscription = (consumer: string) => {
  const sub = bus.list().find((s) => s.consumer === consumer);
  if (!sub) throw new Error(`consumer ${consumer} chưa đăng ký`);
  return sub;
};

const MARKER = {
  meBody: 'Tin của tôi: số tôi là 0912345678',
  peerBody: 'Tin của người kia — giữ nguyên',
  peerName: 'Trần Thị Người Kia',
  myReport: 'Mô tả báo cáo do tôi viết',
  peerReport: 'Báo cáo người kia viết về tôi',
};

/** Dữ liệu của `me` và người kia (`peer`) ở mọi schema. Trả các id cần kiểm tra. */
async function seedEverything(me: string, peer: string) {
  const p = (v: unknown) => JSON.stringify(v);
  // profile
  for (const [userId, name, photos] of [
    [me, 'Nguyễn Văn Tôi', [`profile_photo/${me}/1.jpg`, `profile_photo/${me}/2.jpg`]],
    [peer, MARKER.peerName, [`profile_photo/${peer}/1.jpg`]],
  ] as const) {
    await sql(
      `insert into profile.profiles (user_id, full_name, birth_date, gender, interests, income_range_enc, photo_keys,
         status, created_at, updated_at, version)
       values ($1, $2, '1995-01-01', 'male', '{reading}', $3, $4, 'COMPLETED', $5, $5, 1)`,
      [
        userId,
        name,
        await encryptor.encrypt('20-30m', `profile.profiles.income_range:${userId}`),
        photos,
        NOW,
      ],
    );
    await sql(
      `insert into profile.preferences (user_id, age_min, age_max, children_plan, religion, details, created_at,
         updated_at, version) values ($1, 25, 35, 'open', 'not_important', '{}', $2, $2, 1)`,
      [userId, NOW],
    );
  }
  // verification: hồ sơ đã duyệt (giữ ẩn danh) + lịch phỏng vấn đã xong có nhận xét
  await sql(
    `insert into verification.kyc_submissions (id, user_id, status, steps, cccd_number_enc, cccd_number_bidx,
       cccd_front_key, cccd_back_key, selfie_key, marital_status_certificate_key, ekyc_assessment, created_at,
       submitted_at, decided_at, updated_at, version)
     values ($1, $2, 'APPROVED', $3, $4, 'bidx-me', $5, $6, $7, $8, '{"ocr":"ok"}', $9, $9, $9, $9, 3)`,
    [
      newId(),
      me,
      p({ CCCD_CHIP: { status: 'PASSED', decidedAt: NOW.toISOString() } }),
      await encryptor.encrypt('001095000001', `verification.kyc_submissions.cccd_number:${me}`),
      `kyc_doc/${me}/front.jpg`,
      `kyc_doc/${me}/back.jpg`,
      `kyc_selfie/${me}/selfie.jpg`,
      `kyc_doc/${me}/marital.jpg`,
      NOW,
    ],
  );
  await sql(
    `insert into verification.interview_slots (id, interviewer_id, starts_at, ends_at, status, booked_by, booked_at,
       outcome, notes, created_at, updated_at)
     values ($1, $2, $3, $4, 'COMPLETED', $5, $3, 'PASSED', 'Nhận xét có PII', $3, $3)`,
    [newId(), newId(), addDuration(NOW, { days: -5 }), addDuration(NOW, { days: -5, minutes: 15 }), me],
  );
  // billing: khoản đã trả + voucher RESERVED + ledger
  const paymentId = newId();
  const voucherId = newId();
  await sql(
    `insert into billing.payments (id, order_id, user_id, amount, status, gateway_txn_id, idempotency_key, checkout_url,
       qr_data, created_at, succeeded_at, updated_at, version)
     values ($1, 'VPme', $2, 299000, 'SUCCEEDED', 'txn-me', 'idem-me', 'https://pay.test/x', 'qr', $3, $3, $3, 2)`,
    [paymentId, me, NOW],
  );
  await sql(
    `insert into billing.vouchers (id, user_id, payment_id, value, status, issued_at, updated_at, version)
     values ($1, $2, $3, 300000, 'RESERVED', $4, $4, 1)`,
    [voucherId, me, paymentId, NOW],
  );
  await sql(
    `insert into billing.ledger_entries (id, type, amount, user_id, payment_id, voucher_id, occurred_at)
     values ($1, 'CHARGE', 299000, $3, $4, null, $5), ($2, 'VOUCHER_ISSUE', 300000, $3, $4, $6, $5)`,
    [newId(), newId(), me, paymentId, NOW, voucherId],
  );
  // matching: match DATING đang mở + match cũ bị tôi từ chối (lý do + ghi chú chuyên viên) + read model + cooldown
  const matchId = newId();
  await sql(
    `insert into matching.matches (id, user_a, user_b, created_by, status, accepted_by, staff_note, offered_at,
       expires_at, dating_started_at, updated_at, version)
     values ($1, $2, $3, $4, 'DATING', $5, 'Ghi chú về cặp', $6, $7, $6, $6, 3)`,
    [matchId, me, peer, newId(), [me, peer], addDuration(NOW, { days: -2 }), addDuration(NOW, { days: 12 })],
  );
  await sql(
    `insert into matching.active_slots (user_id, match_id, claimed_at) values ($1, $3, $4), ($2, $3, $4)`,
    [me, peer, matchId, NOW],
  );
  const oldMatchId = newId();
  await sql(
    `insert into matching.matches (id, user_a, user_b, created_by, status, staff_note, offered_at, closed_at,
       declined_by, decline_reason, updated_at, version)
     values ($1, $2, $3, $4, 'DECLINED', 'Ghi chú cũ', $5, $5, $2, 'Lý do riêng tư', $5, 2)`,
    [oldMatchId, me, newId(), newId(), addDuration(NOW, { days: -30 })],
  );
  for (const userId of [me, peer]) {
    await sql(
      `insert into matching.candidate_profiles (user_id, verified, updated_at) values ($1, true, $2)`,
      [userId, NOW],
    );
  }
  await sql(`insert into matching.cooldowns (user_id, until, updated_at) values ($1, $2, $2)`, [me, NOW]);
  // messaging
  const conversationId = newId();
  await sql(
    `insert into messaging.conversations (id, match_id, user_a, user_b, status, opened_at, closes_at, updated_at, version)
     values ($1, $2, $3, $4, 'OPEN', $5, $6, $5, 1)`,
    [conversationId, matchId, me, peer, addDuration(NOW, { days: -2 }), addDuration(NOW, { days: 12 })],
  );
  const myMessageId = newId();
  const peerMessageId = newId();
  await sql(
    `insert into messaging.messages (id, conversation_id, sender_id, kind, body, masked_body, client_message_id, sent_at)
     values ($1, $3, $4, 'TEXT', $6, 'Tin của tôi: số tôi là [SĐT đã ẩn]', $8, $7),
            ($2, $3, $5, 'TEXT', $9, null, null, $7)`,
    [myMessageId, peerMessageId, conversationId, me, peer, MARKER.meBody, NOW, newId(), MARKER.peerBody],
  );
  await sql(
    `insert into messaging.conversation_reads (conversation_id, user_id, last_read_message_id, read_at)
     values ($1, $2, $3, $5), ($1, $4, $3, $5)`,
    [conversationId, me, peerMessageId, peer, NOW],
  );
  // safety: báo cáo tôi gửi (mô tả + bằng chứng) và báo cáo người kia gửi về tôi
  const myReportId = newId();
  const peerReportId = newId();
  await sql(
    `insert into safety.reports (id, reporter_id, reported_user_id, match_id, category, severity, description,
       evidence_keys, urgent, status, created_at, updated_at, version)
     values ($1, $3, $4, $5, 'HARASSMENT', 'HIGH', $6, $7, false, 'OPEN', $9, $9, 1),
            ($2, $4, $3, $5, 'FINANCIAL_SCAM', 'CRITICAL', $8, '{}', false, 'OPEN', $9, $9, 1)`,
    [
      myReportId,
      peerReportId,
      me,
      peer,
      matchId,
      MARKER.myReport,
      [`report_evidence/${me}/e1.jpg`],
      MARKER.peerReport,
      NOW,
    ],
  );
  // notification: token thiết bị, cài đặt, thông báo chờ gửi
  await sql(
    `insert into notification.devices (id, user_id, token, platform, created_at, last_seen_at)
     values ($1, $2, 'ExponentPushToken[me]', 'ios', $4, $4), ($3, $5, 'ExponentPushToken[peer]', 'ios', $4, $4)`,
    [newId(), me, newId(), NOW, peer],
  );
  await sql(
    `insert into notification.preferences (user_id, matches, messages, dates, updated_at) values ($1, true, false, true, $2)`,
    [me, NOW],
  );
  await sql(
    `insert into notification.deliveries (id, event_id, event_type, kind, user_id, aggregate_id, data, status, send_after,
       created_at, updated_at) values ($1, $2, 'MatchOffered', 'MATCH_OFFERED', $3, $4, '{}', 'PENDING', $5, $5, $5)`,
    [newId(), newId(), me, matchId, NOW],
  );
  // platform.uploads: kể cả ảnh chưa gắn vào đâu
  for (const [key, bucket, purpose] of [
    [`profile_photo/${me}/1.jpg`, 'publicProfile', 'profile_photo'],
    [`profile_photo/${me}/orphan.jpg`, 'publicProfile', 'profile_photo'],
    [`report_evidence/${me}/e1.jpg`, 'privateKyc', 'report_evidence'],
    [`profile_photo/${peer}/1.jpg`, 'publicProfile', 'profile_photo'],
  ] as const) {
    await sql(
      `insert into platform.uploads (id, owner_id, key, bucket, purpose, content_type, size_bytes, status, created_at,
         expires_at) values ($1, $2, $3, $4, $5, 'image/jpeg', 1000, 'CONFIRMED', $6, $6)`,
      [newId(), key.includes(me) ? me : peer, key, bucket, purpose, NOW],
    );
  }
  return {
    matchId,
    oldMatchId,
    paymentId,
    voucherId,
    conversationId,
    myMessageId,
    peerMessageId,
    myReportId,
    peerReportId,
  };
}

describe('BE-S7-06 — xuất dữ liệu xuyên module (AC2)', () => {
  it('file xuất chứa dữ liệu của chính chủ ở mọi module, không chứa dữ liệu của người khác', async () => {
    const me = await login('0912345678');
    const peer = await login('0987654321');
    const ids = await seedEverything(me.userId, peer.userId);

    const created = await post('/me/data-exports', {}, me.tokens.accessToken);
    expect(created.status).toBe(202);
    const { exportId } = dataExportViewSchema.parse(await created.json());
    const [event] = await outboxEvents(DATA_EXPORT_REQUESTED);
    expect(
      await deliverOnce(uow, subscription(IDENTITY_BUILD_DATA_EXPORT_CONSUMER), event as DomainEvent),
    ).toBe(true);

    const view = dataExportViewSchema.parse(
      await (await get(`/me/data-exports/${exportId}`, me.tokens.accessToken)).json(),
    );
    const doc = dataExportDocumentSchema.parse(await (await get(view.downloadUrl ?? '')).json());
    expect(Object.keys(doc.sections).sort()).toEqual(
      ['account', 'billing', 'matching', 'messaging', 'profile', 'safety', 'verification'].sort(),
    );
    expect(doc.sections.account).toMatchObject({ userId: me.userId, phone: '+84912345678' });
    expect(doc.sections.profile).toMatchObject({
      profile: { fullName: 'Nguyễn Văn Tôi', incomeRange: '20-30m' },
    });
    expect(doc.sections.verification).toMatchObject({
      kyc: { status: 'APPROVED', cccdNumber: '001095000001' },
    });
    expect(doc.sections.billing).toMatchObject({ payments: [{ orderId: 'VPme', amountVnd: '299000' }] });
    expect(doc.sections.messaging).toMatchObject({ sentMessages: [{ body: MARKER.meBody }] });
    expect(doc.sections.safety).toMatchObject({ reportsFiled: [{ description: MARKER.myReport }] });
    expect(doc.files.map((f) => f.label).sort()).toEqual(
      [
        'cccd_back',
        'cccd_front',
        'marital_status_certificate',
        'profile_photo_1',
        'profile_photo_2',
        'selfie',
        `report_${ids.myReportId}_evidence_1`,
      ].sort(),
    );
    const text = JSON.stringify(doc);
    for (const foreign of [
      MARKER.peerBody,
      MARKER.peerName,
      MARKER.peerReport,
      '+84987654321',
      peer.userId,
    ]) {
      expect(text).not.toContain(foreign);
    }
    expect(text).not.toContain(`profile_photo/${peer.userId}`);
  });
});

describe('BE-S7-06 — xoá tài khoản xuyên module (AC1)', () => {
  it('mỗi module tự xoá/ẩn danh dữ liệu của mình; ledger còn nhưng không liên kết được danh tính; chạy lại idempotent', async () => {
    const me = await login('0912345678');
    const peer = await login('0987654321');
    const [initialMe] = await sql<{ phone_bidx: string }>(
      'select phone_bidx from identity.users where id = $1',
      [me.userId],
    );
    if (!initialMe) throw new Error('user me không tồn tại');
    const ids = await seedEverything(me.userId, peer.userId);

    // Bus của worker có đủ consumer cho mọi bước API báo tiến độ.
    for (const step of STEPS) {
      expect(bus.consumersOf(ACCOUNT_DELETION_REQUESTED).map((s) => s.consumer)).toContain(step.consumer);
    }

    clock.advance({ minutes: 5 });
    expect((await post('/me/account/deletion/otp', {}, me.tokens.accessToken)).status).toBe(200);
    const res = await post('/me/account/deletion', { code: lastCode() }, me.tokens.accessToken);
    expect(res.status).toBe(202);
    const { requestId } = accountDeletionViewSchema.parse(await res.json());
    const [event] = await outboxEvents(ACCOUNT_DELETION_REQUESTED);
    if (!event) throw new Error('không có AccountDeletionRequested');

    for (const sub of bus.consumersOf(ACCOUNT_DELETION_REQUESTED)) {
      expect(await deliverOnce(uow, sub, event)).toBe(true);
    }
    // matching phát MatchLocked → messaging đóng hội thoại.
    for (const locked of await outboxEvents(MATCH_LOCKED)) {
      for (const sub of bus.consumersOf(MATCH_LOCKED)) await deliverOnce(uow, sub, locked);
    }

    const status = accountDeletionViewSchema.parse(
      await (await get(`/account-deletions/${requestId}`)).json(),
    );
    expect(status.status).toBe('COMPLETED');
    expect(status.steps.every((s) => s.done)).toBe(true);

    await expectErased(me.userId, peer.userId, ids, initialMe.phone_bidx);

    // A9: chạy lại handler (bỏ qua processed_events) không lỗi, không đổi kết quả, không huỷ voucher/ghi ledger lần 2.
    for (const sub of bus.consumersOf(ACCOUNT_DELETION_REQUESTED)) {
      await uow.run(async (tx) => {
        await sub.handler(event, tx);
        return ok();
      });
    }
    await expectErased(me.userId, peer.userId, ids, initialMe.phone_bidx);
  });
});

async function expectErased(
  me: string,
  peer: string,
  ids: Awaited<ReturnType<typeof seedEverything>>,
  initialPhoneBidx?: string,
): Promise<void> {
  // identity: không còn SĐT
  const [user] = await sql<{ phone_enc: Buffer; phone_bidx: string }>(
    'select phone_enc, phone_bidx from identity.users where id = $1',
    [me],
  );
  expect(user?.phone_enc.length).toBe(0);
  expect(user?.phone_bidx).toBe(`deleted:${me}`);

  // identity: deleted_phone_indexes có đúng 1 dòng cho user (phone_bidx khác deleted: và bằng phone_bidx ban đầu)
  const deletedPhones = await sql<{ user_id: string; phone_bidx: string }>(
    'select user_id, phone_bidx from identity.deleted_phone_indexes where user_id = $1',
    [me],
  );
  expect(deletedPhones).toHaveLength(1);
  expect(deletedPhones[0]?.phone_bidx).not.toMatch(/^deleted:/);
  if (initialPhoneBidx) {
    expect(deletedPhones[0]?.phone_bidx).toBe(initialPhoneBidx);
  }

  // profile: hồ sơ + tiêu chí của tôi bị xoá, của người kia còn
  expect(await sql('select user_id from profile.profiles where user_id = $1', [me])).toEqual([]);
  expect(await sql('select user_id from profile.preferences where user_id = $1', [me])).toEqual([]);
  expect(await sql('select user_id from profile.profiles where user_id = $1', [peer])).toHaveLength(1);

  // verification: quyết định giữ dạng ẩn danh, không còn CCCD / ảnh / đánh giá; nhận xét phỏng vấn bị xoá
  expect(
    await sql(
      `select status, cccd_number_enc, cccd_number_bidx, cccd_front_key, cccd_back_key, selfie_key,
              marital_status_certificate_key, ekyc_assessment
         from verification.kyc_submissions where user_id = $1`,
      [me],
    ),
  ).toEqual([
    {
      status: 'APPROVED',
      cccd_number_enc: null,
      cccd_number_bidx: null,
      cccd_front_key: null,
      cccd_back_key: null,
      selfie_key: null,
      marital_status_certificate_key: null,
      ekyc_assessment: null,
    },
  ]);
  expect(
    await sql('select outcome, notes from verification.interview_slots where booked_by = $1', [me]),
  ).toEqual([{ outcome: 'PASSED', notes: null }]);

  // billing: ledger còn đủ (+ VOUCHER_VOID), voucher VOID, phiên cổng bị xoá
  const ledger = await sql<{ type: string }>(
    'select type from billing.ledger_entries where payment_id = $1 order by occurred_at, type',
    [ids.paymentId],
  );
  expect(ledger.map((r) => r.type).sort()).toEqual(['CHARGE', 'VOUCHER_ISSUE', 'VOUCHER_VOID']);
  // Quyết định PO: xoá tài khoản không hoàn phí xác thực
  expect(ledger.map((r) => r.type)).not.toContain('REFUND');
  const [payment] = await sql<{ status: string }>('select status from billing.payments where id = $1', [
    ids.paymentId,
  ]);
  expect(payment?.status).toBe('SUCCEEDED');
  expect(['REFUND_PENDING', 'REFUNDED']).not.toContain(payment?.status);
  expect(
    await sql('select status, void_reason from billing.vouchers where id = $1', [ids.voucherId]),
  ).toEqual([{ status: 'VOID', void_reason: 'ACCOUNT_DELETED' }]);
  expect(
    await sql('select checkout_url, qr_data from billing.payments where id = $1', [ids.paymentId]),
  ).toEqual([{ checkout_url: null, qr_data: null }]);
  // "Không liên kết được danh tính": user_id của ledger không còn khớp dữ liệu định danh nào.
  expect(
    await sql(
      `select 1 from identity.users where id = $1 and octet_length(phone_enc) > 0
       union all select 1 from profile.profiles where user_id = $1
       union all select 1 from verification.kyc_submissions where user_id = $1 and cccd_number_enc is not null`,
      [me],
    ),
  ).toEqual([]);

  // matching: match đang mở → LOCKED (ACCOUNT_DELETED), trả slot cho người kia; read model + cooldown bị xoá
  expect(
    await sql('select status, lock_reason, staff_note from matching.matches where id = $1', [ids.matchId]),
  ).toEqual([{ status: 'LOCKED', lock_reason: 'ACCOUNT_DELETED', staff_note: null }]);
  expect(
    await sql('select decline_reason, staff_note from matching.matches where id = $1', [ids.oldMatchId]),
  ).toEqual([{ decline_reason: null, staff_note: null }]);
  expect(await sql('select user_id from matching.active_slots')).toEqual([]);
  expect(await sql('select user_id from matching.candidate_profiles where user_id = $1', [me])).toEqual([]);
  expect(
    await sql('select user_id from matching.candidate_profiles where user_id = $1', [peer]),
  ).toHaveLength(1);
  expect(await sql('select user_id from matching.cooldowns where user_id = $1', [me])).toEqual([]);

  // messaging: nội dung tin tôi gửi bị xoá, tin người kia còn; hội thoại đóng; con trỏ đọc của tôi bị xoá
  const msgs = await sql<{
    id: string;
    body: string;
    masked_body: string | null;
    client_message_id: string | null;
  }>(
    'select id, body, masked_body, client_message_id from messaging.messages where conversation_id = $1 and kind = $2',
    [ids.conversationId, 'TEXT'],
  );
  expect(msgs.find((m) => m.id === ids.myMessageId)).toMatchObject({
    body: '',
    masked_body: null,
    client_message_id: null,
  });
  expect(msgs.find((m) => m.id === ids.peerMessageId)?.body).toBe(MARKER.peerBody);
  expect(
    await sql<{ body: string }>('select body from messaging.messages where body like $1', ['%0912345678%']),
  ).toEqual([]);
  expect(await sql('select status from messaging.conversations where id = $1', [ids.conversationId])).toEqual(
    [{ status: 'CLOSED' }],
  );
  expect(await sql('select user_id from messaging.conversation_reads where user_id = $1', [me])).toEqual([]);

  // safety: báo cáo tôi gửi còn nhưng không mô tả/bằng chứng; báo cáo về tôi giữ nguyên
  expect(
    await sql('select description, evidence_keys, category from safety.reports where id = $1', [
      ids.myReportId,
    ]),
  ).toEqual([{ description: null, evidence_keys: [], category: 'HARASSMENT' }]);
  expect(await sql('select description from safety.reports where id = $1', [ids.peerReportId])).toEqual([
    { description: MARKER.peerReport },
  ]);

  // notification: token + cài đặt của tôi bị xoá, thông báo chờ bị huỷ; token người kia còn
  expect(await sql('select token from notification.devices where user_id = $1', [me])).toEqual([]);
  expect(await sql('select token from notification.devices where user_id = $1', [peer])).toHaveLength(1);
  expect(await sql('select user_id from notification.preferences where user_id = $1', [me])).toEqual([]);
  expect(await sql('select status from notification.deliveries where user_id = $1', [me])).toEqual([
    { status: 'CANCELLED' },
  ]);

  // storage / uploads: mọi object của tôi bị xoá (kể cả ảnh chưa gắn), dòng uploads của tôi bị xoá; của người kia còn
  for (const key of [
    `publicProfile/profile_photo/${me}/1.jpg`,
    `publicProfile/profile_photo/${me}/2.jpg`,
    `publicProfile/profile_photo/${me}/orphan.jpg`,
    `privateKyc/kyc_doc/${me}/front.jpg`,
    `privateKyc/kyc_doc/${me}/back.jpg`,
    `privateKyc/kyc_selfie/${me}/selfie.jpg`,
    `privateKyc/kyc_doc/${me}/marital.jpg`,
    `privateKyc/report_evidence/${me}/e1.jpg`,
  ]) {
    expect(deletedObjects).toContain(key);
  }
  expect(deletedObjects.some((k) => k.includes(peer))).toBe(false);
  expect(await sql('select key from platform.uploads where owner_id = $1', [me])).toEqual([]);
  expect(await sql('select key from platform.uploads where owner_id = $1', [peer])).toHaveLength(1);
}
