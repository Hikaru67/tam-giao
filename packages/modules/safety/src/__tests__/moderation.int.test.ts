import { createLogger } from '@tamgiao/config';
import {
  banUserResponseSchema,
  flaggedMessageDetailResponseSchema,
  flaggedMessageQueueResponseSchema,
  problemSchema,
  reportActionResponseSchema,
  reportDetailResponseSchema,
  reportQueueResponseSchema,
  verifyOtpResponseSchema,
} from '@tamgiao/contracts';
import {
  DrizzleUnitOfWork,
  EventBus,
  HmacBlindIndexer,
  LocalKeyEncryptor,
  OutboxWriter,
  createDatabase,
  deliverOnce,
  type Database,
} from '@tamgiao/db';
import { createRequireAdmin, handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import {
  FakeClock,
  addDuration,
  domainError,
  err,
  newId,
  ok,
  type DomainEvent,
  type ObjectStorage,
} from '@tamgiao/kernel';
import {
  createIdentityModule,
  createIdentityWorker,
  type SmsMessage,
  type SmsSender,
} from '@tamgiao/module-identity';
import { createMatchingModule, createMatchingWorker } from '@tamgiao/module-matching';
import { createMessagingFacade } from '@tamgiao/module-messaging';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Report } from '../domain/report.js';
import { DrizzleReportRepository } from '../infrastructure/drizzle-report-repository.js';
import { createSafetyModule } from '../index.js';

const NOW = new Date('2026-11-21T03:00:00.000Z');
const SUPERVISOR = newId();
const MATCHMAKER = newId();
const PHONE = '0912345678';
/** Văn bản có PII giả — không được lọt vào log / outbox / audit. */
const SECRET = 'STK 0123456789 chuyển gấp';

class CapturingSms implements SmsSender {
  readonly sent: SmsMessage[] = [];
  async send(message: SmsMessage): Promise<void> {
    this.sent.push(message);
  }
  lastCode(): string {
    const code = /\b(\d{6})\b/.exec(this.sent.at(-1)?.text ?? '')?.[1];
    if (!code) throw new Error('chưa có SMS OTP');
    return code;
  }
}

let database: Database;
let uow: DrizzleUnitOfWork;
let app: Hono<AppEnv>;
const clock = new FakeClock(NOW);
const bus = new EventBus();
const sms = new CapturingSms();
const logLines: string[] = [];

const storage: ObjectStorage = {
  presignPut: async () => {
    throw new Error('không dùng');
  },
  presignGet: async (i) => ({
    url: `https://storage.test/get/${i.bucket}/${i.key}`,
    method: 'GET',
    headers: {},
    expiresAt: addDuration(clock.now(), { minutes: 5 }),
  }),
  head: async () => null,
  delete: async () => undefined,
};

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  const identity = createIdentityModule({
    uow,
    clock,
    encryptor: new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) }),
    blindIndexer: new HmacBlindIndexer(Buffer.alloc(32, 9)),
    smsSender: sms,
    authSecret: Buffer.alloc(32, 11),
  });
  const scheduler = { schedule: async () => undefined };
  const matching = createMatchingModule({
    uow,
    clock,
    verification: { isVerified: async () => true },
    auditLogger: identity.auditLogger,
    requireAdmin: () => async (_c, next) => next(),
    requireUser: async (_c, next) => next(),
    profiles: { getMatchDisplayProfiles: async () => [], getApplicantSummaries: async () => [] },
    scheduler,
  });
  // Worker: consumer UserBanned của identity + matching (như `apps/worker`).
  createMatchingWorker({
    clock,
    profiles: { getMatchingProfile: async () => null },
    scheduler,
  }).registerConsumers(bus);
  createIdentityWorker({ clock }).registerConsumers(bus);

  // Token admin giả: `supervisor` có `safety:ban`, `matchmaker` thì không.
  const requireAdmin = createRequireAdmin(async (token) => {
    if (token === 'supervisor') {
      return ok({ adminId: SUPERVISOR, sessionId: newId(), role: 'SUPERVISOR', permissions: ['safety:ban'] });
    }
    if (token === 'matchmaker') {
      return ok({
        adminId: MATCHMAKER,
        sessionId: newId(),
        role: 'MATCHMAKER',
        permissions: ['match:propose'],
      });
    }
    return err(domainError('UNAUTHENTICATED'));
  });
  const safety = createSafetyModule({
    uow,
    clock,
    uploads: { verifyOwned: async () => err(domainError('UPLOAD_NOT_OWNED')) },
    matching: matching.facade,
    requireUser: createMiddleware<AppEnv>(async (_c, next) => next()),
    requireAdmin,
    auditLogger: identity.auditLogger,
    storage,
    messaging: createMessagingFacade({ uow }),
  });
  const logger = createLogger({
    service: 'api',
    level: 'debug',
    destination: { write: (line: string) => void logLines.push(line) },
  });
  app = new Hono<AppEnv>();
  app.use('*', requestContext(logger, { trustProxy: true }));
  app.route('/', identity.routes);
  app.route('/', safety.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);
});

beforeEach(async () => {
  await resetDatabase(database.pool);
  logLines.length = 0;
  sms.sent.length = 0;
  clock.set(NOW);
});

afterAll(() => database.close());

const query = async <T extends object>(text: string, params: unknown[] = []): Promise<T[]> =>
  (await database.pool.query<T>(text, params)).rows;
const code = async (res: Response) => problemSchema.parse(await res.json()).code;

const asAdmin = (token: string | null, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const sup = (method: string, path: string, body?: unknown) => asAdmin('supervisor', method, path, body);

interface AuditRow {
  actor_type: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  ip: string | null;
  meta: Record<string, unknown>;
}
const audits = (action: string) =>
  query<AuditRow>(
    `select actor_type, actor_id, action, target_type, target_id, ip, meta from identity.audit_logs
      where action = $1 order by occurred_at, id`,
    [action],
  );

const reportRepo = new DrizzleReportRepository(new OutboxWriter());
async function seedReport(input: {
  category: 'MARITAL_FRAUD' | 'FINANCIAL_SCAM' | 'HARASSMENT' | 'NO_SHOW_DISRESPECT';
  urgent?: boolean;
  reportedUserId?: string;
  matchId?: string;
}): Promise<Report> {
  const r = Report.file(
    {
      id: newId<'Report'>(),
      reporterId: newId(),
      reportedUserId: input.reportedUserId ?? newId(),
      matchId: input.matchId ?? newId(),
      category: input.category,
      description: SECRET,
      evidenceKeys: ['report_evidence/a.jpg'],
      urgent: input.urgent ?? false,
    },
    clock.now(),
  );
  if (r.isErr()) throw new Error(r.error.code);
  await uow.run(async (tx) => ok(await reportRepo.save(tx, r.value)));
  return r.value;
}

const outboxOf = (eventType: string) =>
  query<{
    id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    aggregate_version: number;
    payload: unknown;
    occurred_at: Date;
  }>(
    `select id, event_type, aggregate_type, aggregate_id, aggregate_version, payload, occurred_at
       from platform.outbox where event_type = $1 order by created_at, id`,
    [eventType],
  );

describe('HTTP phân quyền (safety:ban)', () => {
  const routes: [string, string, unknown?][] = [
    ['GET', '/admin/reports'],
    ['GET', `/admin/reports/${newId()}`],
    ['POST', `/admin/reports/${newId()}/start-review`],
    ['POST', `/admin/reports/${newId()}/resolve`, { outcome: 'DISMISSED', conclusion: 'x' }],
    ['GET', '/admin/flagged-messages'],
    ['GET', `/admin/flagged-messages/${newId()}`],
    ['POST', `/admin/users/${newId()}/ban`, { reason: 'x' }],
  ];

  it.each(routes)(
    '%s %s: không token → 401; MATCHMAKER → 403 FORBIDDEN; không ghi gì',
    async (method, path, body) => {
      const anonymous = await asAdmin(null, method, path, body);
      expect(anonymous.status).toBe(401);
      const forbidden = await asAdmin('matchmaker', method, path, body);
      expect(forbidden.status).toBe(403);
      expect(await code(forbidden)).toBe('FORBIDDEN');
      expect(await query('select id from identity.audit_logs')).toEqual([]);
      expect(await query('select user_id from safety.user_bans')).toEqual([]);
    },
  );
});

describe('Hàng chờ + chi tiết + xử lý báo cáo', () => {
  it('sắp severity giảm dần rồi dueAt tăng dần (không hạn cuối); đánh dấu quá SLA; lọc trạng thái', async () => {
    const low = await seedReport({ category: 'NO_SHOW_DISRESPECT' });
    const highLater = await seedReport({ category: 'FINANCIAL_SCAM' });
    clock.advance({ minutes: -10 });
    const highUrgentEarly = await seedReport({ category: 'FINANCIAL_SCAM', urgent: true });
    clock.advance({ minutes: 5 });
    const highUrgentLate = await seedReport({ category: 'FINANCIAL_SCAM', urgent: true });
    const critical = await seedReport({ category: 'MARITAL_FRAUD' });
    clock.set(addDuration(NOW, { minutes: 21 })); // hạn của bản khẩn sớm = NOW - 10 + 30 = NOW + 20 → quá SLA

    const res = await sup('GET', '/admin/reports');
    expect(res.status).toBe(200);
    const page = reportQueueResponseSchema.parse(await res.json());
    expect(page.total).toBe(5);
    expect(page.items.map((i) => i.reportId)).toEqual([
      critical.id,
      highUrgentEarly.id,
      highUrgentLate.id,
      highLater.id,
      low.id,
    ]);
    expect(page.items.map((i) => i.overdue)).toEqual([false, true, false, false, false]);
    expect(JSON.stringify(page)).not.toContain('0123456789');
    // Danh sách không ghi audit.
    expect(await query('select id from identity.audit_logs')).toEqual([]);

    const paged = reportQueueResponseSchema.parse(
      await (await sup('GET', '/admin/reports?limit=2&offset=1')).json(),
    );
    expect(paged.items.map((i) => i.reportId)).toEqual([highUrgentEarly.id, highUrgentLate.id]);

    const resolved = reportQueueResponseSchema.parse(
      await (await sup('GET', '/admin/reports?status=RESOLVED')).json(),
    );
    expect(resolved).toEqual({ items: [], total: 0 });
    expect((await sup('GET', '/admin/reports?status=NOPE')).status).toBe(422);
  });

  it('AC2: mỗi lần mở chi tiết ghi audit; start-review → resolve ghi kết luận + audit; DTO kiểm tra kết luận', async () => {
    const report = await seedReport({ category: 'HARASSMENT', urgent: true });
    for (let i = 0; i < 2; i += 1) {
      const res = await sup('GET', `/admin/reports/${report.id}`);
      expect(res.status).toBe(200);
      const detail = reportDetailResponseSchema.parse(await res.json());
      expect(detail).toMatchObject({
        reportId: report.id,
        description: SECRET,
        status: 'OPEN',
        evidence: [
          {
            key: 'report_evidence/a.jpg',
            url: 'https://storage.test/get/privateKyc/report_evidence/a.jpg',
          },
        ],
      });
    }
    const viewed = await audits('safety.report.view_detail');
    expect(viewed).toHaveLength(2);
    expect(viewed[0]).toEqual({
      actor_type: 'admin',
      actor_id: SUPERVISOR,
      action: 'safety.report.view_detail',
      target_type: 'safety_report',
      target_id: report.id,
      ip: '203.0.113.9',
      meta: { status: 'OPEN', reportedUserId: report.toState().reportedUserId },
    });
    expect((await sup('GET', `/admin/reports/${newId()}`)).status).toBe(404);
    expect(await audits('safety.report.view_detail')).toHaveLength(2);

    const started = await sup('POST', `/admin/reports/${report.id}/start-review`);
    expect(started.status).toBe(200);
    expect(reportActionResponseSchema.parse(await started.json())).toMatchObject({
      status: 'IN_REVIEW',
      handledBy: SUPERVISOR,
    });

    const blank = await sup('POST', `/admin/reports/${report.id}/resolve`, {
      outcome: 'RESOLVED',
      conclusion: '   ',
    });
    expect(blank.status).toBe(422);
    expect(await code(blank)).toBe('VALIDATION_FAILED');

    clock.advance({ minutes: 2 });
    const resolved = await sup('POST', `/admin/reports/${report.id}/resolve`, {
      outcome: 'RESOLVED',
      conclusion: `Xác minh: ${SECRET}`,
    });
    expect(resolved.status).toBe(200);
    expect(reportActionResponseSchema.parse(await resolved.json())).toMatchObject({
      status: 'RESOLVED',
      closedAt: clock.now().toISOString(),
    });
    const [row] = await query<{ status: string; conclusion: string; handled_by: string; version: number }>(
      'select status, conclusion, handled_by, version from safety.reports where id = $1',
      [report.id],
    );
    expect(row).toEqual({
      status: 'RESOLVED',
      conclusion: `Xác minh: ${SECRET}`,
      handled_by: SUPERVISOR,
      version: 3,
    });
    expect((await outboxOf('ReportStatusChanged')).map((r) => r.payload)).toEqual([
      { reportId: report.id, fromStatus: 'OPEN', toStatus: 'IN_REVIEW' },
      { reportId: report.id, fromStatus: 'IN_REVIEW', toStatus: 'RESOLVED' },
    ]);
    expect((await audits('safety.report.close')).map((a) => a.meta)).toEqual([
      { outcome: 'RESOLVED', fromStatus: 'IN_REVIEW', toStatus: 'RESOLVED' },
    ]);

    const again = await sup('POST', `/admin/reports/${report.id}/resolve`, {
      outcome: 'DISMISSED',
      conclusion: 'x',
    });
    expect(again.status).toBe(409);
    expect(await code(again)).toBe('REPORT_INVALID_TRANSITION');

    const allAudit = JSON.stringify(await query('select meta from identity.audit_logs'));
    expect(allAudit).not.toContain('0123456789');
    expect(logLines.join('\n')).not.toContain('0123456789');
  });
});

describe('Hàng chờ tin bị gắn cờ (facade messaging)', () => {
  async function seedConversation(): Promise<{
    conversationId: string;
    matchId: string;
    a: string;
    b: string;
  }> {
    const conversationId = newId();
    const matchId = newId();
    const a = newId();
    const b = newId();
    await database.pool.query(
      `insert into messaging.conversations (id, match_id, user_a, user_b, status, opened_at, closes_at, updated_at, version)
       values ($1, $2, $3, $4, 'OPEN', $5, $6, $5, 1)`,
      [conversationId, matchId, a, b, NOW, addDuration(NOW, { days: 14 })],
    );
    return { conversationId, matchId, a, b };
  }
  async function seedMessage(
    conversationId: string,
    senderId: string,
    sentAt: Date,
    reasons: string[],
    body = SECRET,
  ): Promise<string> {
    const id = newId();
    await database.pool.query(
      `insert into messaging.messages (id, conversation_id, sender_id, kind, body, flagged, flag_reasons, sent_at)
       values ($1, $2, $3, 'TEXT', $4, $5, $6, $7)`,
      [id, conversationId, senderId, body, reasons.length > 0, reasons, sentAt],
    );
    return id;
  }

  it('danh sách mới nhất trước, phân trang cursor, không có nội dung; chi tiết có nội dung + audit (AC2)', async () => {
    const { conversationId, matchId, a, b } = await seedConversation();
    const m1 = await seedMessage(conversationId, a, addDuration(NOW, { minutes: 1 }), ['BANK_ACCOUNT']);
    await seedMessage(conversationId, b, addDuration(NOW, { minutes: 2 }), [], 'chào anh');
    const m3 = await seedMessage(conversationId, b, addDuration(NOW, { minutes: 3 }), [
      'INVESTMENT',
      'CRYPTO',
    ]);
    const m4 = await seedMessage(conversationId, a, addDuration(NOW, { minutes: 4 }), ['BANK_ACCOUNT']);

    const first = flaggedMessageQueueResponseSchema.parse(
      await (await sup('GET', '/admin/flagged-messages?limit=2')).json(),
    );
    expect(first.items.map((i) => i.messageId)).toEqual([m4, m3]);
    expect(first.items[1]).toEqual({
      messageId: m3,
      conversationId,
      matchId,
      senderId: b,
      recipientId: a,
      reasons: ['INVESTMENT', 'CRYPTO'],
      sentAt: addDuration(NOW, { minutes: 3 }).toISOString(),
    });
    expect(JSON.stringify(first)).not.toContain('0123456789');
    expect(first.nextCursor).not.toBeNull();
    const second = flaggedMessageQueueResponseSchema.parse(
      await (await sup('GET', `/admin/flagged-messages?limit=2&cursor=${first.nextCursor ?? ''}`)).json(),
    );
    expect(second.items.map((i) => i.messageId)).toEqual([m1]);
    expect(second.nextCursor).toBeNull();
    expect((await sup('GET', '/admin/flagged-messages?cursor=bad')).status).toBe(422);
    expect(await query('select id from identity.audit_logs')).toEqual([]);

    const detail = await sup('GET', `/admin/flagged-messages/${m1}`);
    expect(detail.status).toBe(200);
    expect(flaggedMessageDetailResponseSchema.parse(await detail.json())).toMatchObject({
      messageId: m1,
      senderId: a,
      recipientId: b,
      body: SECRET,
    });
    const viewed = await audits('safety.flagged_message.view_detail');
    expect(viewed).toEqual([
      {
        actor_type: 'admin',
        actor_id: SUPERVISOR,
        action: 'safety.flagged_message.view_detail',
        target_type: 'flagged_message',
        target_id: m1,
        ip: '203.0.113.9',
        meta: { conversationId, senderId: a, reasons: ['BANK_ACCOUNT'] },
      },
    ]);
    expect(JSON.stringify(viewed)).not.toContain('0123456789');
    expect(logLines.join('\n')).not.toContain('0123456789');
  });

  it('tin không bị gắn cờ / không tồn tại → 404 FLAGGED_MESSAGE_NOT_FOUND, không audit', async () => {
    const { conversationId, a } = await seedConversation();
    const clean = await seedMessage(conversationId, a, NOW, [], 'xin chào');
    for (const id of [clean, newId(), 'nope']) {
      const res = await sup('GET', `/admin/flagged-messages/${id}`);
      expect(res.status).toBe(404);
      expect(await code(res)).toBe('FLAGGED_MESSAGE_NOT_FOUND');
    }
    expect(await query('select id from identity.audit_logs')).toEqual([]);
  });
});

describe('BanUser → UserBanned → identity + matching (chuỗi event, AC1)', () => {
  async function login(deviceName: string) {
    clock.advance({ minutes: 5 });
    await app.request('/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: PHONE }),
    });
    return app.request('/auth/otp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: PHONE, code: sms.lastCode(), deviceName }),
    });
  }

  const deliverAll = async (event: DomainEvent) => {
    for (const sub of bus.list().filter((s) => s.eventType === event.type)) {
      expect(await deliverOnce(uow, sub, event)).toBe(true);
    }
  };

  it('ban qua HTTP (lý do bắt buộc) → token bị thu hồi, đăng nhập lại 403, match LOCKED, khỏi read model ứng viên', async () => {
    const loginRes = await login('iPhone');
    const { userId, tokens } = verifyOtpResponseSchema.parse(await loginRes.json());
    const partner = newId();
    const matchId = newId();
    await database.pool.query(
      `insert into matching.matches
         (id, user_a, user_b, created_by, status, accepted_by, offered_at, expires_at, dating_started_at, updated_at, version)
       values ($1, $2, $3, $4, 'DATING', $5, $6, $7, $6, $6, 3)`,
      [matchId, userId, partner, newId(), [userId, partner], NOW, addDuration(NOW, { days: 14 })],
    );
    await database.pool.query(
      `insert into matching.active_slots (user_id, match_id, claimed_at) values ($1, $3, $4), ($2, $3, $4)`,
      [userId, partner, matchId, NOW],
    );
    await database.pool.query(
      `insert into matching.candidate_profiles (user_id, verified, updated_at) values ($1, true, $2)`,
      [userId, NOW],
    );
    const report = await seedReport({ category: 'FINANCIAL_SCAM', reportedUserId: userId, matchId });

    const noReason = await sup('POST', `/admin/users/${userId}/ban`, { reason: '  ' });
    expect(noReason.status).toBe(422);
    expect(await code(noReason)).toBe('VALIDATION_FAILED');

    const res = await sup('POST', `/admin/users/${userId}/ban`, { reason: SECRET, reportId: report.id });
    expect(res.status).toBe(201);
    const ban = banUserResponseSchema.parse(await res.json());
    expect(ban).toMatchObject({ userId, reportId: report.id, bannedBy: SUPERVISOR });
    const [banRow] = await query<{ reason: string }>(
      'select reason from safety.user_bans where user_id = $1',
      [userId],
    );
    expect(banRow?.reason).toBe(SECRET);

    const banned = await outboxOf('UserBanned');
    expect(banned.map((r) => [r.aggregate_type, r.aggregate_id, r.payload])).toEqual([
      ['UserBan', ban.banId, { banId: ban.banId, userId, bannedBy: SUPERVISOR, reportId: report.id }],
    ]);
    expect((await audits('safety.user.ban')).map((a) => [a.target_type, a.target_id, a.meta])).toEqual([
      ['user', userId, { banId: ban.banId, reportId: report.id }],
    ]);

    const twice = await sup('POST', `/admin/users/${userId}/ban`, { reason: 'lần hai' });
    expect(twice.status).toBe(409);
    expect(await code(twice)).toBe('USER_ALREADY_BANNED');

    // Worker: relay giao UserBanned cho consumer identity + matching.
    const row = banned[0];
    if (!row) throw new Error('thiếu UserBanned');
    await deliverAll({
      eventId: row.id,
      type: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      version: row.aggregate_version,
      occurredAt: row.occurred_at,
      payload: row.payload,
    });

    // Identity: access + refresh token bị thu hồi, đăng nhập lại bị chặn.
    const sessions = await app.request('/auth/sessions', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(sessions.status).toBe(401);
    const refreshed = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    expect(refreshed.status).toBe(401);
    const relogin = await login('Pixel');
    expect(relogin.status).toBe(403);
    expect(await code(relogin)).toBe('ACCOUNT_BANNED');

    // Matching: match bị khoá (messaging đóng hội thoại qua MatchLocked), ra khỏi read model ứng viên.
    const [match] = await query<{ status: string; lock_reason: string }>(
      'select status, lock_reason from matching.matches where id = $1',
      [matchId],
    );
    expect(match).toEqual({ status: 'LOCKED', lock_reason: 'USER_BANNED' });
    expect(await query('select * from matching.active_slots')).toEqual([]);
    const [candidate] = await query<{ verified: boolean }>(
      'select verified from matching.candidate_profiles where user_id = $1',
      [userId],
    );
    expect(candidate?.verified).toBe(false);

    // Không lọt lý do khoá (PII) vào outbox / audit / log.
    expect(JSON.stringify(await query('select payload from platform.outbox'))).not.toContain('0123456789');
    expect(JSON.stringify(await query('select meta from identity.audit_logs'))).not.toContain('0123456789');
    expect(logLines.join('\n')).not.toContain('0123456789');
  });

  it('A10: hai admin khoá cùng lúc → đúng 1 bản ghi + 1 UserBanned, bên còn lại USER_ALREADY_BANNED', async () => {
    const userId = newId();
    const results = await runConcurrently(2, async () =>
      sup('POST', `/admin/users/${userId}/ban`, { reason: 'lừa đảo' }),
    );
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    expect(statuses.sort()).toEqual([201, 409]);
    expect(await query('select user_id from safety.user_bans')).toHaveLength(1);
    expect(await outboxOf('UserBanned')).toHaveLength(1);
    expect(await audits('safety.user.ban')).toHaveLength(1);
  });

  it('reportId không phải báo cáo về người này → 404 REPORT_NOT_FOUND', async () => {
    const report = await seedReport({ category: 'HARASSMENT' });
    const res = await sup('POST', `/admin/users/${newId()}/ban`, { reason: 'x', reportId: report.id });
    expect(res.status).toBe(404);
    expect(await code(res)).toBe('REPORT_NOT_FOUND');
    expect(await query('select user_id from safety.user_bans')).toEqual([]);
  });
});
