import { createLogger } from '@tamgiao/config';
import { fileReportResponseSchema, problemSchema } from '@tamgiao/contracts';
import { SAFETY_RESPONSE_SLA_MINUTES } from '@tamgiao/contracts/constants';
import {
  DrizzleUnitOfWork,
  EventBus,
  OutboxWriter,
  UploadService,
  createDatabase,
  deliverOnce,
  type Database,
} from '@tamgiao/db';
import { handleError, handleNotFound, requestContext, type AppEnv } from '@tamgiao/http';
import {
  FakeClock,
  addDuration,
  newId,
  ok,
  type DomainError,
  type DomainEvent,
  type ObjectStorage,
  type Result,
} from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import {
  MATCH_LOCK_ON_REPORT_FILED_CONSUMER,
  createMatchingModule,
  createMatchingWorker,
  type MatchingModule,
} from '@tamgiao/module-matching';
import { resetDatabase, testDatabaseUrl, withRollback } from '@tamgiao/testing';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Report, type ReportId } from '../domain/report.js';
import { DrizzleReportRepository } from '../infrastructure/drizzle-report-repository.js';
import { createSafetyModule } from '../index.js';

const NOW = new Date('2026-11-21T03:00:00.000Z');
/** Mô tả có PII giả (SĐT) — không được xuất hiện trong log / outbox. */
const ADMIN_ID = newId();
const SECRET_DESCRIPTION = 'Anh ấy xin chuyển khoản gấp, SĐT 0912345678';

let database: Database;
let uow: DrizzleUnitOfWork;
let uploads: UploadService;
let matching: MatchingModule;
let app: Hono<AppEnv>;
const bus = new EventBus();
const clock = new FakeClock(NOW);
const logLines: string[] = [];
const scheduled: unknown[] = [];

/** Storage giả: mọi object "đã được tải lên" đúng như khai báo. */
const declared = new Map<string, { sizeBytes: number; contentType: string }>();
const storage: ObjectStorage = {
  presignPut: async (i) => {
    declared.set(i.key, { sizeBytes: i.sizeBytes, contentType: i.contentType });
    return { url: `https://storage.test/put/${i.key}`, method: 'PUT', headers: {}, expiresAt: clock.now() };
  },
  presignGet: async (i) => ({
    url: `https://storage.test/get/${i.key}`,
    method: 'GET',
    headers: {},
    expiresAt: clock.now(),
  }),
  head: async (_b, key) => declared.get(key) ?? null,
  delete: async () => undefined,
};

const auditLogger: AuditLogger = { log: async (): Promise<Result<void, DomainError>> => ok() };
const scheduler = {
  schedule: async (_tx: unknown, job: unknown) => {
    scheduled.push(job);
  },
};

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  uploads = new UploadService({ uow, clock, storage, putTtlSeconds: 300 });
  matching = createMatchingModule({
    uow,
    clock,
    verification: { isVerified: async () => true },
    auditLogger,
    requireAdmin: () => async (_c, next) => next(),
    requireUser: async (_c, next) => next(),
    profiles: { getMatchDisplayProfiles: async () => [], getApplicantSummaries: async () => [] },
    scheduler,
  });
  // Consumer phía worker của matching (ReportFiled → LockMatch) — cùng cách `apps/worker` đăng ký.
  createMatchingWorker({
    clock,
    profiles: { getMatchingProfile: async () => null },
    scheduler,
  }).registerConsumers(bus);

  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.req.header('x-test-user');
    if (!userId) return c.json({ code: 'UNAUTHENTICATED' }, 401);
    c.set('auth', { userId, sessionId: newId() });
    return next();
  });
  const safety = createSafetyModule({
    uow,
    clock,
    uploads,
    matching: matching.facade,
    requireUser,
    requireAdmin: () => async (_c, next) => next(),
    auditLogger,
    storage,
    messaging: {
      listFlaggedMessages: async () => ({ items: [], nextCursor: null }),
      getFlaggedMessage: async () => null,
    },
  });
  const logger = createLogger({
    service: 'api',
    level: 'debug',
    destination: { write: (line: string) => void logLines.push(line) },
  });
  app = new Hono<AppEnv>();
  app.use('*', requestContext(logger));
  app.route('/', safety.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);
});

beforeEach(async () => {
  await resetDatabase(database.pool);
  logLines.length = 0;
  scheduled.length = 0;
  clock.set(NOW);
});

afterAll(() => database.close());

const query = async <T extends object>(text: string, params: unknown[] = []): Promise<T[]> =>
  (await database.pool.query<T>(text, params)).rows;

/**
 * Seed một match giữa hai người bằng SQL (bảng của matching — test chỉ dựng dữ liệu; code safety không đọc bảng này,
 * A3). Match mở thì giữ active slot của cả hai như `ProposeMatch`.
 */
async function seedMatch(
  status: 'DATING' | 'OFFERED' | 'DECLINED',
  offeredAt: Date = addDuration(NOW, { days: -3 }),
): Promise<{ matchId: string; a: string; b: string }> {
  const matchId = newId();
  const a = newId();
  const b = newId();
  const open = status !== 'DECLINED';
  await database.pool.query(
    `insert into matching.matches
       (id, user_a, user_b, created_by, status, accepted_by, offered_at, expires_at, dating_started_at, closed_at,
        declined_by, updated_at, version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $7, $12)`,
    [
      matchId,
      a,
      b,
      newId(),
      status,
      status === 'DATING' ? [a, b] : [],
      offeredAt,
      open ? addDuration(NOW, { days: 10 }) : null,
      status === 'DATING' ? offeredAt : null,
      open ? null : offeredAt,
      open ? null : a,
      status === 'DATING' ? 3 : status === 'OFFERED' ? 1 : 2,
    ],
  );
  if (open) {
    await database.pool.query(
      `insert into matching.active_slots (user_id, match_id, claimed_at) values ($1, $3, $4), ($2, $3, $4)`,
      [a, b, matchId, offeredAt],
    );
  }
  return { matchId, a, b };
}

async function evidenceKey(
  ownerId: string,
  purpose: 'report_evidence' | 'profile_photo' = 'report_evidence',
) {
  const r = await uploads.requestUpload({ ownerId, purpose, contentType: 'image/jpeg', sizeBytes: 100 });
  if (r.isErr()) throw new Error(r.error.code);
  return r.value.key;
}

const postReport = (userId: string, body: unknown) =>
  app.request('/me/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': userId },
    body: JSON.stringify(body),
  });
const code = async (res: Response) => problemSchema.parse(await res.json()).code;

interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  payload: unknown;
  occurred_at: Date;
}

const outboxOf = (eventType: string) =>
  query<OutboxRow>(
    `select id, event_type, aggregate_type, aggregate_id, aggregate_version, payload, occurred_at
       from platform.outbox where event_type = $1 order by created_at, id`,
    [eventType],
  );

const toEvent = (row: OutboxRow): DomainEvent => ({
  eventId: row.id,
  type: row.event_type,
  aggregateType: row.aggregate_type,
  aggregateId: row.aggregate_id,
  version: row.aggregate_version,
  occurredAt: row.occurred_at,
  payload: row.payload,
});

const lockConsumer = () => {
  const sub = bus.list().find((s) => s.consumer === MATCH_LOCK_ON_REPORT_FILED_CONSUMER);
  if (!sub) throw new Error('consumer chưa đăng ký');
  return sub;
};

describe('POST /me/reports → ReportFiled → LockMatch (chuỗi event report → lock)', () => {
  it('AC1: báo cáo → 201 + ReportFiled trong outbox; consumer matching khoá match LOCKED, MatchLocked trong outbox, trả slot', async () => {
    const { matchId, a, b } = await seedMatch('DATING');
    const key = await evidenceKey(a);

    const res = await postReport(a, {
      reportedUserId: b,
      category: 'FINANCIAL_SCAM',
      description: SECRET_DESCRIPTION,
      evidenceKeys: [key],
      urgentIntervention: true,
    });
    expect(res.status).toBe(201);
    const body = fileReportResponseSchema.parse(await res.json());
    const dueAt = addDuration(NOW, { minutes: SAFETY_RESPONSE_SLA_MINUTES }).toISOString();
    expect(body).toMatchObject({
      status: 'OPEN',
      category: 'FINANCIAL_SCAM',
      severity: 'HIGH',
      urgent: true,
      dueAt,
      createdAt: NOW.toISOString(),
    });

    const [row] = await query<Record<string, unknown>>('select * from safety.reports where id = $1', [
      body.reportId,
    ]);
    expect(row).toMatchObject({
      reporter_id: a,
      reported_user_id: b,
      match_id: matchId,
      description: SECRET_DESCRIPTION,
      evidence_keys: [key],
      status: 'OPEN',
      version: 1,
    });
    const [upload] = await query<{ status: string }>('select status from platform.uploads where key = $1', [
      key,
    ]);
    expect(upload?.status).toBe('CONFIRMED');

    const filed = await outboxOf('ReportFiled');
    expect(filed).toHaveLength(1);
    expect(filed[0]?.payload).toEqual({
      reportId: body.reportId,
      reporterId: a,
      reportedUserId: b,
      matchId,
      category: 'FINANCIAL_SCAM',
      severity: 'HIGH',
      urgent: true,
      dueAt,
    });
    expect(JSON.stringify(filed[0]?.payload)).not.toContain('0912345678');

    // Worker: relay giao ReportFiled cho consumer `matching.lock-on-report-filed` (deliverOnce = như registerConsumers).
    clock.advance({ minutes: 1 });
    expect(await deliverOnce(uow, lockConsumer(), toEvent(filed[0] as OutboxRow))).toBe(true);

    const [match] = await query<{ status: string; lock_reason: string; version: number }>(
      'select status, lock_reason, version from matching.matches where id = $1',
      [matchId],
    );
    expect(match).toEqual({ status: 'LOCKED', lock_reason: 'REPORT_FILED', version: 4 });
    expect(await query('select * from matching.active_slots')).toEqual([]);
    const locked = await outboxOf('MatchLocked');
    expect(locked.map((r) => r.payload)).toEqual([
      { matchId, participantIds: [a, b], fromStatus: 'DATING', reason: 'REPORT_FILED' },
    ]);
    // Hội thoại `CLOSED` do messaging xử lý `MatchLocked` (BE-S6-01) — ngoài phạm vi test này.

    // Giao lại cùng event → bỏ qua (processed_events), không event mới.
    expect(await deliverOnce(uow, lockConsumer(), toEvent(filed[0] as OutboxRow))).toBe(false);
    expect(await outboxOf('MatchLocked')).toHaveLength(1);
    expect(scheduled).toEqual([]);

    // Không log PII (mô tả báo cáo).
    expect(logLines.join('\n')).not.toContain('0912345678');
  });

  it('báo cáo thứ hai về cùng match đã LOCKED → consumer no-op (A9)', async () => {
    const { matchId, a, b } = await seedMatch('OFFERED');
    expect((await postReport(a, { reportedUserId: b, category: 'HARASSMENT' })).status).toBe(201);
    expect((await postReport(b, { reportedUserId: a, category: 'NO_SHOW_DISRESPECT' })).status).toBe(201);
    for (const row of await outboxOf('ReportFiled')) {
      expect(await deliverOnce(uow, lockConsumer(), toEvent(row))).toBe(true);
    }
    const [match] = await query<{ status: string }>('select status from matching.matches where id = $1', [
      matchId,
    ]);
    expect(match?.status).toBe('LOCKED');
    expect(await outboxOf('MatchLocked')).toHaveLength(1);
  });

  it('AC2: báo cáo người đã từng ghép (match đã đóng) → 201; consumer không đổi match đã đóng', async () => {
    const { matchId, a, b } = await seedMatch('DECLINED');
    const res = await postReport(b, { reportedUserId: a, category: 'HARASSMENT' });
    expect(res.status).toBe(201);
    const [filed] = await outboxOf('ReportFiled');
    expect(filed?.payload).toMatchObject({ matchId });
    await deliverOnce(uow, lockConsumer(), toEvent(filed as OutboxRow));
    const [match] = await query<{ status: string }>('select status from matching.matches where id = $1', [
      matchId,
    ]);
    expect(match?.status).toBe('DECLINED');
    expect(await outboxOf('MatchLocked')).toEqual([]);
  });

  it('AC2: người chưa từng ghép với mình → 422 REPORT_TARGET_INVALID; chính mình → 422; không ghi gì', async () => {
    const { a } = await seedMatch('DATING');
    const stranger = newId();
    const res = await postReport(a, { reportedUserId: stranger, category: 'HARASSMENT' });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe('REPORT_TARGET_INVALID');
    const self = await postReport(a, { reportedUserId: a, category: 'HARASSMENT' });
    expect(self.status).toBe(422);
    expect(await code(self)).toBe('REPORT_TARGET_INVALID');
    expect(await query('select id from safety.reports')).toEqual([]);
    expect(await outboxOf('ReportFiled')).toEqual([]);
  });

  it('AC3: key bằng chứng của người khác → 403 UPLOAD_NOT_OWNED; sai mục đích → 422 UPLOAD_INVALID; rollback', async () => {
    const { a, b } = await seedMatch('DATING');
    const mine = await evidenceKey(a);
    const theirs = await evidenceKey(b);
    const res = await postReport(a, {
      reportedUserId: b,
      category: 'FINANCIAL_SCAM',
      evidenceKeys: [mine, theirs],
    });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('UPLOAD_NOT_OWNED');

    const photo = await evidenceKey(a, 'profile_photo');
    const wrong = await postReport(a, {
      reportedUserId: b,
      category: 'FINANCIAL_SCAM',
      evidenceKeys: [photo],
    });
    expect(wrong.status).toBe(422);
    expect(await code(wrong)).toBe('UPLOAD_INVALID');

    expect(await query('select id from safety.reports')).toEqual([]);
    expect(await outboxOf('ReportFiled')).toEqual([]);
    const [upload] = await query<{ status: string }>('select status from platform.uploads where key = $1', [
      mine,
    ]);
    expect(upload?.status).toBe('PENDING');
  });

  it('DTO: mô tả 1001 ký tự / 6 ảnh / loại lạ → 422 VALIDATION_FAILED; chưa đăng nhập → 401', async () => {
    const { a, b } = await seedMatch('DATING');
    for (const body of [
      { reportedUserId: b, category: 'HARASSMENT', description: 'x'.repeat(1001) },
      { reportedUserId: b, category: 'HARASSMENT', evidenceKeys: ['1', '2', '3', '4', '5', '6'] },
      { reportedUserId: b, category: 'OTHER' },
      { reportedUserId: 'nope', category: 'HARASSMENT' },
    ]) {
      const res = await postReport(a, body);
      expect(res.status).toBe(422);
      expect(await code(res)).toBe('VALIDATION_FAILED');
    }
    const anonymous = await app.request('/me/reports', { method: 'POST', body: '{}' });
    expect(anonymous.status).toBe(401);
  });
});

describe('DrizzleReportRepository', () => {
  const repo = new DrizzleReportRepository(new OutboxWriter());

  const newReport = (): Report => {
    const r = Report.file(
      {
        id: newId<'Report'>(),
        reporterId: newId(),
        reportedUserId: newId(),
        matchId: newId(),
        category: 'MARITAL_FRAUD',
        description: 'mô tả',
        evidenceKeys: ['k1', 'k2'],
        urgent: true,
      },
      NOW,
    );
    if (r.isErr()) throw new Error(r.error.code);
    return r.value;
  };

  it('lưu → đọc lại đúng state; đổi trạng thái → UPDATE + ReportStatusChanged', async () => {
    const report = newReport();
    const expected = report.toState();
    await uow.run(async (tx) => ok(await repo.save(tx, report)));

    const loaded = await withRollback(uow, (tx) => repo.findById(tx, report.id));
    expect(loaded?.toState()).toEqual(expected);

    const later = addDuration(NOW, { hours: 1 });
    await uow.run(async (tx) => {
      const r = await repo.findById(tx, report.id);
      if (!r) throw new Error('missing');
      r.startReview(later, ADMIN_ID);
      r.resolve(later, { staffId: ADMIN_ID, conclusion: 'Có vi phạm' });
      await repo.save(tx, r);
      return ok();
    });
    const after = await withRollback(uow, (tx) => repo.findById(tx, report.id));
    expect(after?.toState()).toMatchObject({
      status: 'RESOLVED',
      closedAt: later,
      handledBy: ADMIN_ID,
      conclusion: 'Có vi phạm',
      version: 3,
    });
    expect((await outboxOf('ReportStatusChanged')).map((r) => r.payload)).toEqual([
      { reportId: report.id, fromStatus: 'OPEN', toStatus: 'IN_REVIEW' },
      { reportId: report.id, fromStatus: 'IN_REVIEW', toStatus: 'RESOLVED' },
    ]);
  });

  it('xung đột version (bản cũ ghi đè) → throw, rollback', async () => {
    const report = newReport();
    await uow.run(async (tx) => ok(await repo.save(tx, report)));
    const stale = await withRollback(uow, (tx) => repo.findById(tx, report.id));
    const fresh = await withRollback(uow, (tx) => repo.findById(tx, report.id));
    if (!stale || !fresh) throw new Error('missing');
    fresh.startReview(NOW, ADMIN_ID);
    await uow.run(async (tx) => ok(await repo.save(tx, fresh)));
    stale.dismiss(NOW, { staffId: ADMIN_ID, conclusion: 'Bác bỏ' });
    await expect(uow.run(async (tx) => ok(await repo.save(tx, stale)))).rejects.toThrow(/xung đột version/);
    const now = await withRollback(uow, (tx) => repo.findById(tx, report.id as ReportId));
    expect(now?.status).toBe('IN_REVIEW');
  });

  it('CHECK DB: tự báo cáo / urgent không có due_at bị chặn', async () => {
    const u = newId();
    const insert = (reporter: string, reported: string, urgent: boolean, dueAt: Date | null) =>
      database.pool.query(
        `insert into safety.reports (id, reporter_id, reported_user_id, match_id, category, severity, urgent, due_at,
           status, created_at, updated_at, version)
         values ($1, $2, $3, $4, 'HARASSMENT', 'MEDIUM', $5, $6, 'OPEN', now(), now(), 1)`,
        [newId(), reporter, reported, newId(), urgent, dueAt],
      );
    await expect(insert(u, u, false, null)).rejects.toThrow(/reports_distinct_users_ck/);
    await expect(insert(u, newId(), true, null)).rejects.toThrow(/reports_urgent_due_at_ck/);
  });
});
