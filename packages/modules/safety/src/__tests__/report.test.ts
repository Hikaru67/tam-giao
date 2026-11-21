import { SAFETY_RESPONSE_SLA_MINUTES } from '@tamgiao/contracts/constants';
import { addDuration, newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import {
  REPORT_CATEGORIES,
  REPORT_CONCLUSION_MAX_LENGTH,
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_MAX_EVIDENCE,
  Report,
  type FileReportInput,
  type ReportStatus,
} from '../domain/report.js';

const NOW = new Date('2026-11-21T03:00:00.000Z');

const input = (over: Partial<FileReportInput> = {}): FileReportInput => ({
  id: newId<'Report'>(),
  reporterId: newId(),
  reportedUserId: newId(),
  matchId: newId(),
  category: 'FINANCIAL_SCAM',
  ...over,
});

const filed = (over: Partial<FileReportInput> = {}): Report => {
  const r = Report.file(input(over), NOW);
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
};

describe('Report.file', () => {
  it('tạo OPEN, phát đúng 1 ReportFiled không chứa mô tả / key bằng chứng', () => {
    const i = input({ description: '  Anh ấy xin chuyển khoản 0912345678  ', evidenceKeys: ['k1'] });
    const r = Report.file(i, NOW);
    if (r.isErr()) throw new Error(r.error.code);
    const report = r.value;
    expect(report.status).toBe('OPEN');
    expect(report.version).toBe(1);
    expect(report.toState()).toMatchObject({
      description: 'Anh ấy xin chuyển khoản 0912345678',
      evidenceKeys: ['k1'],
      urgent: false,
      dueAt: null,
      severity: 'HIGH',
      createdAt: NOW,
      closedAt: null,
      handledBy: null,
      conclusion: null,
    });
    const events = report.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'ReportFiled',
      aggregateType: 'Report',
      aggregateId: i.id,
      version: 1,
      occurredAt: NOW,
      payload: {
        reportId: i.id,
        reporterId: i.reporterId,
        reportedUserId: i.reportedUserId,
        matchId: i.matchId,
        category: 'FINANCIAL_SCAM',
        severity: 'HIGH',
        urgent: false,
        dueAt: null,
      },
    });
    const serialized = JSON.stringify(events[0]?.payload);
    expect(serialized).not.toContain('0912345678');
    expect(serialized).not.toContain('k1');
  });

  it('"Chuyên viên can thiệp khẩn cấp" → dueAt = now + SAFETY_RESPONSE_SLA_MINUTES', () => {
    const report = filed({ urgent: true });
    const due = addDuration(NOW, { minutes: SAFETY_RESPONSE_SLA_MINUTES });
    expect(report.urgent).toBe(true);
    expect(report.dueAt).toEqual(due);
    expect(report.pullEvents()[0]?.payload).toMatchObject({ urgent: true, dueAt: due.toISOString() });
  });

  it.each([
    ['MARITAL_FRAUD', 'CRITICAL'],
    ['FINANCIAL_SCAM', 'HIGH'],
    ['HARASSMENT', 'MEDIUM'],
    ['NO_SHOW_DISRESPECT', 'LOW'],
  ] as const)('mức độ theo loại %s → %s', (category, severity) => {
    expect(filed({ category }).severity).toBe(severity);
  });

  it('phủ đủ mọi loại vi phạm', () => {
    expect(REPORT_CATEGORIES).toHaveLength(4);
  });

  it('tự báo cáo chính mình (khác hoa/thường) → REPORT_TARGET_INVALID {SELF}', () => {
    const me = newId();
    const r = Report.file(input({ reporterId: me, reportedUserId: me.toUpperCase() }), NOW);
    expect(r.isErr() && r.error).toEqual({ code: 'REPORT_TARGET_INVALID', details: { reason: 'SELF' } });
  });

  it('mô tả: đúng 1000 ký tự được; 1001 → REPORT_DESCRIPTION_TOO_LONG; chỉ khoảng trắng → null', () => {
    const max = 'a'.repeat(REPORT_DESCRIPTION_MAX_LENGTH);
    expect(filed({ description: ` ${max} ` }).toState().description).toBe(max);
    const tooLong = Report.file(input({ description: `${max}b` }), NOW);
    expect(tooLong.isErr() && tooLong.error).toEqual({
      code: 'REPORT_DESCRIPTION_TOO_LONG',
      details: { maxLength: 1000 },
    });
    expect(filed({ description: '   ' }).toState().description).toBeNull();
    expect(filed({ description: null }).toState().description).toBeNull();
  });

  it('bằng chứng: bỏ trùng + rỗng, tối đa 5; 6 key khác nhau → REPORT_EVIDENCE_TOO_MANY', () => {
    const five = ['a', 'b', 'c', 'd', 'e'];
    expect(filed({ evidenceKeys: [...five, 'a', ' b ', ''] }).toState().evidenceKeys).toEqual(five);
    const six = Report.file(input({ evidenceKeys: [...five, 'f'] }), NOW);
    expect(six.isErr() && six.error).toEqual({
      code: 'REPORT_EVIDENCE_TOO_MANY',
      details: { max: REPORT_MAX_EVIDENCE },
    });
  });
});

describe('Report — trạng thái xử lý', () => {
  const later = addDuration(NOW, { hours: 1 });
  const STAFF = 'admin-1';
  const OTHER_STAFF = 'admin-2';
  const close = { staffId: STAFF, conclusion: '  Đã xác minh vi phạm  ' };

  /** Đưa báo cáo tới trạng thái `status`. */
  const at = (status: ReportStatus): Report => {
    const r = filed();
    if (status === 'IN_REVIEW' || status === 'RESOLVED') r.startReview(NOW, OTHER_STAFF);
    if (status === 'RESOLVED') r.resolve(NOW, close);
    if (status === 'DISMISSED') r.dismiss(NOW, close);
    r.pullEvents();
    return r;
  };

  const actions = {
    startReview: (r: Report) => r.startReview(later, STAFF),
    resolve: (r: Report) => r.resolve(later, close),
    dismiss: (r: Report) => r.dismiss(later, close),
  } as const;

  const allowed: Record<ReportStatus, Partial<Record<keyof typeof actions, ReportStatus>>> = {
    OPEN: { startReview: 'IN_REVIEW', dismiss: 'DISMISSED' },
    IN_REVIEW: { resolve: 'RESOLVED', dismiss: 'DISMISSED' },
    RESOLVED: {},
    DISMISSED: {},
  };

  const cases = (Object.keys(allowed) as ReportStatus[]).flatMap((status) =>
    (Object.keys(actions) as (keyof typeof actions)[]).map((action) => [status, action] as const),
  );

  it.each(cases)('%s × %s', (status, action) => {
    const report = at(status);
    const before = report.toState();
    const result = actions[action](report);
    const target = allowed[status][action];
    if (target === undefined) {
      expect(result.isErr() && result.error).toEqual({
        code: 'REPORT_INVALID_TRANSITION',
        details: { action, status },
      });
      expect(report.toState()).toEqual(before);
      expect(report.pullEvents()).toEqual([]);
      return;
    }
    expect(result.isOk()).toBe(true);
    expect(report.status).toBe(target);
    expect(report.version).toBe(before.version + 1);
    expect(report.toState()).toMatchObject({
      closedAt: target === 'IN_REVIEW' ? null : later,
      handledBy: STAFF,
      conclusion: target === 'IN_REVIEW' ? null : 'Đã xác minh vi phạm',
    });
    const events = report.pullEvents();
    expect(events.map((e) => [e.type, e.payload])).toEqual([
      ['ReportStatusChanged', { reportId: report.id, fromStatus: status, toStatus: target }],
    ]);
  });

  it.each([
    ['resolve', 'IN_REVIEW'],
    ['dismiss', 'OPEN'],
  ] as const)(
    '%s: kết luận rỗng / quá dài → REPORT_CONCLUSION_INVALID, không đổi state',
    (action, status) => {
      for (const conclusion of ['   ', 'x'.repeat(REPORT_CONCLUSION_MAX_LENGTH + 1)]) {
        const report = at(status);
        const before = report.toState();
        const result = report[action](later, { staffId: STAFF, conclusion });
        expect(result.isErr() && result.error).toEqual({
          code: 'REPORT_CONCLUSION_INVALID',
          details: { maxLength: REPORT_CONCLUSION_MAX_LENGTH },
        });
        expect(report.toState()).toEqual(before);
        expect(report.pullEvents()).toEqual([]);
      }
      const ok = at(status)[action](later, {
        staffId: STAFF,
        conclusion: 'x'.repeat(REPORT_CONCLUSION_MAX_LENGTH),
      });
      expect(ok.isOk()).toBe(true);
    },
  );

  it('restore ↔ toState giữ nguyên dữ liệu', () => {
    const report = filed({ urgent: true, evidenceKeys: ['x'], description: 'mô tả' });
    const state = report.toState();
    expect(Report.restore(state).toState()).toEqual(state);
  });
});
