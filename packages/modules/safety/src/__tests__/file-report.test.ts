import { SAFETY_RESPONSE_SLA_MINUTES } from '@tamgiao/contracts/constants';
import { FakeClock, addDuration, newId } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { FileReport } from '../application/file-report.js';
import {
  FakeMatchingFacade,
  FakeUploadRegistry,
  InMemoryReportRepository,
  SnapshotUnitOfWork,
} from './fakes.js';

const NOW = new Date('2026-11-21T03:00:00.000Z');

describe('FileReport', () => {
  let clock: FakeClock;
  let reports: InMemoryReportRepository;
  let uploads: FakeUploadRegistry;
  let matching: FakeMatchingFacade;
  let uow: SnapshotUnitOfWork;
  let useCase: FileReport;
  let reporter: string;
  let reported: string;
  let matchId: string;

  beforeEach(() => {
    clock = new FakeClock(NOW);
    reports = new InMemoryReportRepository();
    uploads = new FakeUploadRegistry();
    matching = new FakeMatchingFacade();
    uow = new SnapshotUnitOfWork([reports]);
    useCase = new FileReport({ uow, clock, reports, uploads, matching });
    reporter = newId();
    reported = newId();
    matchId = newId();
    matching.pair(reporter, reported, { matchId, status: 'DATING', isOpen: true });
  });

  it('ghi báo cáo OPEN + ReportFiled vào outbox với matchId của cặp', async () => {
    const key = uploads.add('report_evidence/x/1.jpg', reporter);
    const r = await useCase.execute({
      reporterId: reporter,
      reportedUserId: reported,
      category: 'MARITAL_FRAUD',
      description: 'Đã có vợ',
      evidenceKeys: [key],
    });
    if (r.isErr()) throw new Error(r.error.code);
    expect(r.value).toMatchObject({
      status: 'OPEN',
      category: 'MARITAL_FRAUD',
      severity: 'CRITICAL',
      urgent: false,
      dueAt: null,
      createdAt: NOW,
    });
    expect(reports.states.get(r.value.reportId)).toMatchObject({
      reporterId: reporter,
      reportedUserId: reported,
      matchId,
      description: 'Đã có vợ',
      evidenceKeys: [key],
    });
    expect(reports.outbox).toEqual([
      {
        type: 'ReportFiled',
        payload: {
          reportId: r.value.reportId,
          reporterId: reporter,
          reportedUserId: reported,
          matchId,
          category: 'MARITAL_FRAUD',
          severity: 'CRITICAL',
          urgent: false,
          dueAt: null,
        },
      },
    ]);
    expect(uploads.verified).toEqual([key]);
  });

  it('báo cáo được người đã từng ghép (match đã đóng) — vẫn gắn matchId gần nhất', async () => {
    matching.pair(reporter, reported, { matchId, status: 'DECLINED', isOpen: false });
    const r = await useCase.execute({
      reporterId: reporter,
      reportedUserId: reported,
      category: 'HARASSMENT',
    });
    expect(r.isOk()).toBe(true);
    expect(reports.outbox[0]?.payload).toMatchObject({ matchId });
  });

  it('khẩn cấp → dueAt = now + SAFETY_RESPONSE_SLA_MINUTES', async () => {
    const r = await useCase.execute({
      reporterId: reporter,
      reportedUserId: reported,
      category: 'HARASSMENT',
      urgentIntervention: true,
    });
    if (r.isErr()) throw new Error(r.error.code);
    expect(r.value.urgent).toBe(true);
    expect(r.value.dueAt).toEqual(addDuration(NOW, { minutes: SAFETY_RESPONSE_SLA_MINUTES }));
  });

  it('AC2: chưa từng được ghép với người này → REPORT_TARGET_INVALID {NEVER_MATCHED}, không ghi gì', async () => {
    const stranger = newId();
    const r = await useCase.execute({
      reporterId: reporter,
      reportedUserId: stranger,
      category: 'HARASSMENT',
    });
    expect(r.isErr() && r.error).toEqual({
      code: 'REPORT_TARGET_INVALID',
      details: { reason: 'NEVER_MATCHED' },
    });
    expect(reports.states.size).toBe(0);
    expect(uow.runs).toBe(0);
  });

  it('AC2: tự báo cáo chính mình → REPORT_TARGET_INVALID {SELF}', async () => {
    const r = await useCase.execute({
      reporterId: reporter,
      reportedUserId: reporter,
      category: 'HARASSMENT',
    });
    expect(r.isErr() && r.error).toEqual({ code: 'REPORT_TARGET_INVALID', details: { reason: 'SELF' } });
  });

  it('AC3: key bằng chứng của người khác → UPLOAD_NOT_OWNED (meta.index), rollback, không event', async () => {
    const mine = uploads.add('k-mine', reporter);
    const theirs = uploads.add('k-theirs', reported);
    const r = await useCase.execute({
      reporterId: reporter,
      reportedUserId: reported,
      category: 'FINANCIAL_SCAM',
      evidenceKeys: [mine, theirs],
    });
    expect(r.isErr() && r.error).toEqual({ code: 'UPLOAD_NOT_OWNED', details: { index: 1 } });
    expect(reports.states.size).toBe(0);
    expect(reports.outbox).toEqual([]);
  });

  it('AC3: key sai mục đích (ảnh hồ sơ) → UPLOAD_INVALID', async () => {
    const photo = uploads.add('k-photo', reporter, 'profile_photo');
    const r = await useCase.execute({
      reporterId: reporter,
      reportedUserId: reported,
      category: 'FINANCIAL_SCAM',
      evidenceKeys: [photo],
    });
    expect(r.isErr() && r.error.code).toBe('UPLOAD_INVALID');
    expect(reports.states.size).toBe(0);
  });

  it('mô tả quá dài → REPORT_DESCRIPTION_TOO_LONG, không mở transaction', async () => {
    const r = await useCase.execute({
      reporterId: reporter,
      reportedUserId: reported,
      category: 'FINANCIAL_SCAM',
      description: 'x'.repeat(1001),
    });
    expect(r.isErr() && r.error.code).toBe('REPORT_DESCRIPTION_TOO_LONG');
    expect(uow.runs).toBe(0);
  });
});
