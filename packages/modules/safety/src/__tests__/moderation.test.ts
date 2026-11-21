import { SAFETY_RESPONSE_SLA_MINUTES } from '@tamgiao/contracts/constants';
import { FakeClock, addDuration, newId, type ObjectStorage } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { BanUser } from '../application/admin/ban-user.js';
import { GetFlaggedMessage, ListFlaggedMessages } from '../application/admin/flagged-messages.js';
import { GetReportDetail } from '../application/admin/get-report-detail.js';
import {
  GetReportQueue,
  REPORT_QUEUE_DEFAULT_STATUSES,
  REPORT_QUEUE_PAGE_MAX,
} from '../application/admin/get-report-queue.js';
import { ResolveReport, StartReportReview } from '../application/admin/report-actions.js';
import type { ReportQueueRow } from '../application/ports/report-queue.js';
import { Report } from '../domain/report.js';
import { BAN_REASON_MAX_LENGTH, UserBan } from '../domain/user-ban.js';
import {
  FakeMessagingFacade,
  FakeReportQueue,
  InMemoryReportRepository,
  InMemoryUserBanRepository,
  RecordingAuditLogger,
  SnapshotUnitOfWork,
} from './fakes.js';

const NOW = new Date('2026-11-21T03:00:00.000Z');
const ADMIN = newId();
const actor = { adminId: ADMIN, ip: '203.0.113.9' };

const storage: ObjectStorage = {
  presignPut: async () => {
    throw new Error('không dùng');
  },
  presignGet: async (i) => ({
    url: `https://storage.test/get/${i.bucket}/${i.key}`,
    method: 'GET',
    headers: {},
    expiresAt: addDuration(NOW, { minutes: 5 }),
  }),
  head: async () => null,
  delete: async () => undefined,
};

let clock: FakeClock;
let reports: InMemoryReportRepository;
let bans: InMemoryUserBanRepository;
let audit: RecordingAuditLogger;
let uow: SnapshotUnitOfWork;

beforeEach(() => {
  clock = new FakeClock(NOW);
  reports = new InMemoryReportRepository();
  bans = new InMemoryUserBanRepository();
  audit = new RecordingAuditLogger();
  uow = new SnapshotUnitOfWork([reports]);
});

async function seedReport(urgent = true): Promise<Report> {
  const r = Report.file(
    {
      id: newId<'Report'>(),
      reporterId: newId(),
      reportedUserId: newId(),
      matchId: newId(),
      category: 'FINANCIAL_SCAM',
      description: 'xin chuyển khoản 0912345678',
      evidenceKeys: ['ev/1.jpg', 'ev/2.jpg'],
      urgent,
    },
    NOW,
  );
  if (r.isErr()) throw new Error(r.error.code);
  await reports.save({} as never, r.value);
  reports.outbox = [];
  return r.value;
}

describe('UserBan (domain)', () => {
  it('ban: trim lý do, phát UserBanned không chứa lý do', () => {
    const id = newId<'UserBan'>();
    const userId = newId();
    const r = UserBan.ban({ id, userId, reason: '  Lừa đảo chuyển khoản 0912345678 ', bannedBy: ADMIN }, NOW);
    if (r.isErr()) throw new Error(r.error.code);
    expect(r.value.toState()).toEqual({
      id,
      userId,
      reason: 'Lừa đảo chuyển khoản 0912345678',
      reportId: null,
      bannedBy: ADMIN,
      bannedAt: NOW,
      version: 1,
    });
    const events = r.value.pullEvents();
    expect(events.map((e) => [e.type, e.aggregateType, e.payload])).toEqual([
      ['UserBanned', 'UserBan', { banId: id, userId, bannedBy: ADMIN, reportId: null }],
    ]);
    expect(JSON.stringify(events)).not.toContain('0912345678');
  });

  it.each(['', '   ', 'x'.repeat(BAN_REASON_MAX_LENGTH + 1)])(
    'lý do không hợp lệ → BAN_REASON_INVALID',
    (reason) => {
      const r = UserBan.ban({ id: newId<'UserBan'>(), userId: newId(), reason, bannedBy: ADMIN }, NOW);
      expect(r.isErr() && r.error).toEqual({
        code: 'BAN_REASON_INVALID',
        details: { maxLength: BAN_REASON_MAX_LENGTH },
      });
    },
  );

  it('restore ↔ toState', () => {
    const r = UserBan.ban({ id: newId<'UserBan'>(), userId: newId(), reason: 'x', bannedBy: ADMIN }, NOW);
    if (r.isErr()) throw new Error(r.error.code);
    const s = r.value.toState();
    expect(UserBan.restore(s).toState()).toEqual(s);
  });
});

describe('GetReportQueue', () => {
  const row = (over: Partial<ReportQueueRow>): ReportQueueRow => ({
    reportId: newId(),
    reporterId: newId(),
    reportedUserId: newId(),
    matchId: newId(),
    category: 'HARASSMENT',
    severity: 'MEDIUM',
    status: 'OPEN',
    urgent: false,
    dueAt: null,
    handledBy: null,
    createdAt: NOW,
    ...over,
  });

  it('mặc định OPEN + IN_REVIEW, chặn limit; overdue khi có hạn đã qua và chưa đóng', async () => {
    const queue = new FakeReportQueue();
    const past = addDuration(NOW, { minutes: -1 });
    const future = addDuration(NOW, { minutes: 1 });
    queue.result = {
      total: 5,
      rows: [
        row({ urgent: true, dueAt: past }),
        row({ urgent: true, dueAt: NOW, status: 'IN_REVIEW' }),
        row({ urgent: true, dueAt: future }),
        row({ urgent: true, dueAt: past, status: 'RESOLVED' }),
        row({}),
      ],
    };
    const result = await new GetReportQueue({ uow, clock, queue }).execute({ limit: 10_000, offset: -3 });
    expect(queue.filters).toEqual([
      { statuses: REPORT_QUEUE_DEFAULT_STATUSES, limit: REPORT_QUEUE_PAGE_MAX, offset: 0 },
    ]);
    const page = result.isOk() ? result.value : null;
    expect(page?.total).toBe(5);
    expect(page?.items.map((i) => i.overdue)).toEqual([true, true, false, false, false]);
  });

  it('truyền bộ lọc trạng thái', async () => {
    const queue = new FakeReportQueue();
    await new GetReportQueue({ uow, clock, queue }).execute({ statuses: ['RESOLVED'], limit: 5, offset: 10 });
    expect(queue.filters).toEqual([{ statuses: ['RESOLVED'], limit: 5, offset: 10 }]);
  });
});

describe('GetReportDetail (AC2: mỗi lần mở có audit)', () => {
  const detail = () => new GetReportDetail({ uow, clock, reports, auditLogger: audit, storage });

  it('trả mô tả + presigned URL bằng chứng (bucket private); mỗi lần mở ghi 1 audit trong tx', async () => {
    const report = await seedReport();
    clock.advance({ minutes: SAFETY_RESPONSE_SLA_MINUTES + 1 });
    for (let i = 0; i < 2; i += 1) {
      const result = await detail().execute({ reportId: report.id, actor });
      const v = result.isOk() ? result.value : null;
      expect(v).toMatchObject({
        id: report.id,
        description: 'xin chuyển khoản 0912345678',
        overdue: true,
        evidence: [
          { key: 'ev/1.jpg', url: 'https://storage.test/get/privateKyc/ev/1.jpg' },
          { key: 'ev/2.jpg', url: 'https://storage.test/get/privateKyc/ev/2.jpg' },
        ],
      });
    }
    expect(audit.entries).toHaveLength(2);
    expect(audit.entries[0]).toEqual({
      withTx: true,
      entry: {
        actor: { type: 'admin', id: ADMIN },
        action: 'safety.report.view_detail',
        targetType: 'safety_report',
        targetId: report.id,
        ip: actor.ip,
        meta: { status: 'OPEN', reportedUserId: report.toState().reportedUserId },
      },
    });
    expect(JSON.stringify(audit.entries)).not.toContain('0912345678');
  });

  it('không có / id sai dạng → REPORT_NOT_FOUND, không audit', async () => {
    for (const reportId of [newId(), 'nope']) {
      const r = await detail().execute({ reportId, actor });
      expect(r.isErr() && r.error.code).toBe('REPORT_NOT_FOUND');
    }
    expect(audit.entries).toEqual([]);
  });

  it('audit bị từ chối → throw, không trả dữ liệu', async () => {
    const report = await seedReport();
    audit.failWith = 'AUDIT_ENTRY_INVALID';
    await expect(detail().execute({ reportId: report.id, actor })).rejects.toThrow(/audit log/);
  });
});

describe('StartReportReview / ResolveReport', () => {
  const deps = () => ({ uow, clock, reports, auditLogger: audit });

  it('start-review: OPEN → IN_REVIEW, ghi handledBy + ReportStatusChanged + audit', async () => {
    const report = await seedReport();
    const r = await new StartReportReview(deps()).execute({ reportId: report.id, actor });
    expect(r.isOk() && r.value).toMatchObject({ status: 'IN_REVIEW', handledBy: ADMIN, closedAt: null });
    expect(reports.outbox.map((e) => e.payload)).toEqual([
      { reportId: report.id, fromStatus: 'OPEN', toStatus: 'IN_REVIEW' },
    ]);
    expect(audit.entries.map((e) => [e.entry.action, e.entry.meta])).toEqual([
      ['safety.report.start_review', { fromStatus: 'OPEN', toStatus: 'IN_REVIEW' }],
    ]);
    const again = await new StartReportReview(deps()).execute({ reportId: report.id, actor });
    expect(again.isErr() && again.error.code).toBe('REPORT_INVALID_TRANSITION');
  });

  it('resolve RESOLVED từ OPEN: tự nhận xử lý rồi kết luận (2 event), lưu kết luận, audit không kèm kết luận', async () => {
    const report = await seedReport();
    clock.advance({ minutes: 3 });
    const r = await new ResolveReport(deps()).execute({
      reportId: report.id,
      outcome: 'RESOLVED',
      conclusion: ' Xác minh có chuyển khoản 0912345678 ',
      actor,
    });
    expect(r.isOk() && r.value).toMatchObject({
      status: 'RESOLVED',
      handledBy: ADMIN,
      closedAt: clock.now(),
    });
    expect(reports.states.get(report.id)).toMatchObject({
      status: 'RESOLVED',
      conclusion: 'Xác minh có chuyển khoản 0912345678',
      handledBy: ADMIN,
      version: 3,
    });
    expect(reports.outbox.map((e) => e.payload)).toEqual([
      { reportId: report.id, fromStatus: 'OPEN', toStatus: 'IN_REVIEW' },
      { reportId: report.id, fromStatus: 'IN_REVIEW', toStatus: 'RESOLVED' },
    ]);
    expect(audit.entries.map((e) => [e.withTx, e.entry.action, e.entry.meta])).toEqual([
      [true, 'safety.report.close', { outcome: 'RESOLVED', fromStatus: 'OPEN', toStatus: 'RESOLVED' }],
    ]);
    expect(JSON.stringify(audit.entries)).not.toContain('0912345678');
  });

  it('DISMISSED từ OPEN; kết luận rỗng → REPORT_CONCLUSION_INVALID (rollback); đã đóng → REPORT_INVALID_TRANSITION', async () => {
    const report = await seedReport();
    const blank = await new ResolveReport(deps()).execute({
      reportId: report.id,
      outcome: 'RESOLVED',
      conclusion: '  ',
      actor,
    });
    expect(blank.isErr() && blank.error.code).toBe('REPORT_CONCLUSION_INVALID');
    expect(reports.states.get(report.id)?.status).toBe('OPEN');
    expect(reports.outbox).toEqual([]);

    const dismissed = await new ResolveReport(deps()).execute({
      reportId: report.id,
      outcome: 'DISMISSED',
      conclusion: 'Không đủ bằng chứng',
      actor,
    });
    expect(dismissed.isOk() && dismissed.value.status).toBe('DISMISSED');
    const closed = await new ResolveReport(deps()).execute({
      reportId: report.id,
      outcome: 'RESOLVED',
      conclusion: 'x',
      actor,
    });
    expect(closed.isErr() && closed.error.code).toBe('REPORT_INVALID_TRANSITION');
    expect(audit.entries).toHaveLength(1);
  });

  it('không có báo cáo → REPORT_NOT_FOUND', async () => {
    const r = await new StartReportReview(deps()).execute({ reportId: newId(), actor });
    expect(r.isErr() && r.error.code).toBe('REPORT_NOT_FOUND');
  });
});

describe('BanUser', () => {
  const banUser = () => new BanUser({ uow, clock, bans, reports, auditLogger: audit });

  it('khoá: lưu lý do, UserBanned vào outbox (không lý do), audit safety.user.ban', async () => {
    const report = await seedReport();
    const userId = report.toState().reportedUserId;
    const r = await banUser().execute({ userId, reason: 'Lừa đảo 0912345678', reportId: report.id, actor });
    const view = r.isOk() ? r.value : null;
    expect(view).toMatchObject({ userId, reportId: report.id, bannedBy: ADMIN, bannedAt: NOW });
    expect(bans.states.get(userId)?.reason).toBe('Lừa đảo 0912345678');
    expect(bans.outbox).toEqual([
      {
        type: 'UserBanned',
        payload: { banId: view?.banId, userId, bannedBy: ADMIN, reportId: report.id },
      },
    ]);
    expect(
      audit.entries.map((e) => [
        e.withTx,
        e.entry.action,
        e.entry.targetType,
        e.entry.targetId,
        e.entry.meta,
      ]),
    ).toEqual([[true, 'safety.user.ban', 'user', userId, { banId: view?.banId, reportId: report.id }]]);
    expect(JSON.stringify([bans.outbox, audit.entries])).not.toContain('0912345678');
  });

  it('khoá lần hai → USER_ALREADY_BANNED, không event mới', async () => {
    const userId = newId();
    expect((await banUser().execute({ userId, reason: 'a', actor })).isOk()).toBe(true);
    const again = await banUser().execute({ userId, reason: 'b', actor });
    expect(again.isErr() && again.error.code).toBe('USER_ALREADY_BANNED');
    expect(bans.outbox).toHaveLength(1);
    expect(audit.entries).toHaveLength(1);
  });

  it('lý do rỗng → BAN_REASON_INVALID; userId sai dạng → VALIDATION_FAILED; báo cáo không về người này → REPORT_NOT_FOUND', async () => {
    const report = await seedReport();
    const blank = await banUser().execute({ userId: newId(), reason: '   ', actor });
    expect(blank.isErr() && blank.error.code).toBe('BAN_REASON_INVALID');
    const bad = await banUser().execute({ userId: 'x', reason: 'a', actor });
    expect(bad.isErr() && bad.error.code).toBe('VALIDATION_FAILED');
    const wrong = await banUser().execute({ userId: newId(), reason: 'a', reportId: report.id, actor });
    expect(wrong.isErr() && wrong.error.code).toBe('REPORT_NOT_FOUND');
    const missing = await banUser().execute({ userId: newId(), reason: 'a', reportId: newId(), actor });
    expect(missing.isErr() && missing.error.code).toBe('REPORT_NOT_FOUND');
    expect(bans.states.size).toBe(0);
    expect(audit.entries).toEqual([]);
  });
});

describe('ListFlaggedMessages / GetFlaggedMessage (AC2)', () => {
  const messaging = new FakeMessagingFacade();
  const message = {
    messageId: newId(),
    conversationId: newId(),
    matchId: newId(),
    senderId: newId(),
    recipientId: newId(),
    reasons: ['BANK_TRANSFER'],
    sentAt: NOW,
    body: 'chuyển khoản vào STK 0123456789',
    maskedBody: null,
  };
  messaging.messages.set(message.messageId, message);

  it('danh sách: chặn limit, không audit', async () => {
    const r = await new ListFlaggedMessages({ messaging }).execute({ cursor: null, limit: 999 });
    expect(r.isOk() && r.value.items).toHaveLength(1);
    expect(messaging.listCalls.at(-1)).toEqual({ cursor: null, limit: 100 });
  });

  it('chi tiết: trả nội dung + ghi audit (không có nội dung trong audit); không có → FLAGGED_MESSAGE_NOT_FOUND', async () => {
    const get = new GetFlaggedMessage({ messaging, auditLogger: audit });
    const r = await get.execute({ messageId: message.messageId, actor });
    expect(r.isOk() && r.value.body).toBe(message.body);
    expect(audit.entries).toEqual([
      {
        withTx: false,
        entry: {
          actor: { type: 'admin', id: ADMIN },
          action: 'safety.flagged_message.view_detail',
          targetType: 'flagged_message',
          targetId: message.messageId,
          ip: actor.ip,
          meta: {
            conversationId: message.conversationId,
            senderId: message.senderId,
            reasons: ['BANK_TRANSFER'],
          },
        },
      },
    ]);
    expect(JSON.stringify(audit.entries)).not.toContain('0123456789');

    const missing = await get.execute({ messageId: newId(), actor });
    expect(missing.isErr() && missing.error.code).toBe('FLAGGED_MESSAGE_NOT_FOUND');
    expect(audit.entries).toHaveLength(1);
  });

  it('audit lỗi → throw, không trả nội dung', async () => {
    audit.failWith = 'AUDIT_ENTRY_INVALID';
    await expect(
      new GetFlaggedMessage({ messaging, auditLogger: audit }).execute({
        messageId: message.messageId,
        actor,
      }),
    ).rejects.toThrow(/audit log/);
  });
});
