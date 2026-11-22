import { addDuration, newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import {
  DateFeedback,
  decideFeedbackOutcome,
  FEEDBACK_NOTE_MAX_LENGTH,
  FEEDBACK_SUBMITTED,
  type FeedbackAnswers,
  type FeedbackDateContext,
} from '../domain/date-feedback.js';
import type { DatePlanStatus } from '../domain/date-plan.js';

const NOW = new Date('2026-12-05T10:00:00.000Z');
const A = newId();
const B = newId();
const MATCH = newId();
const PLAN = newId<'DatePlan'>();

const date = (over: Partial<FeedbackDateContext> = {}): FeedbackDateContext => ({
  datePlanId: PLAN,
  matchId: MATCH,
  inviterId: A,
  inviteeId: B,
  status: 'CONFIRMED',
  startsAt: addDuration(NOW, { hours: -2 }),
  ...over,
});

const commit: FeedbackAnswers = {
  rating: 5,
  profileMatch: 'FULL_MATCH',
  feeling: 'DEEP_INTEREST',
  decision: 'A_COMMIT',
  stopReasons: [],
  stopNote: null,
};
const stop: FeedbackAnswers = {
  rating: 2,
  profileMatch: 'DIFFERENT',
  feeling: 'NOT_A_FIT',
  decision: 'B_STOP',
  stopReasons: ['NO_SPARK', 'NO_SPARK', 'LIFESTYLE_DIFFERENCE'],
  stopNote: '  khác quan điểm  ',
};

const submit = (
  authorId: string,
  answers: FeedbackAnswers,
  counterpart: DateFeedback | null = null,
  ctx: FeedbackDateContext = date(),
  now: Date = NOW,
) => DateFeedback.submit({ id: newId<'DateFeedback'>(), date: ctx, authorId, answers }, counterpart, now);

const ok = (authorId: string, answers: FeedbackAnswers, counterpart: DateFeedback | null = null) => {
  const r = submit(authorId, answers, counterpart);
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
};

describe('decideFeedbackOutcome', () => {
  it.each([
    [[], null],
    [['A_COMMIT'], null],
    [['A_COMMIT', 'A_COMMIT'], 'SUCCESS'],
    [['B_STOP'], 'STOPPED'],
    [['A_COMMIT', 'B_STOP'], 'STOPPED'],
    [['B_STOP', 'B_STOP'], 'STOPPED'],
  ] as const)('%j → %s', (decisions, expected) => {
    expect(decideFeedbackOutcome(decisions)).toBe(expected);
  });
});

describe('DateFeedback.submit — FeedbackSubmitted phát đúng một lần / match', () => {
  it('A_COMMIT đầu tiên → lưu, chưa phát event (chờ người còn lại)', () => {
    const fb = ok(A, commit);
    expect(fb.pullEvents()).toEqual([]);
    expect(fb.toState()).toMatchObject({ authorId: A, subjectId: B, matchId: MATCH, submittedAt: NOW });
  });

  it('AC1: cả hai A_COMMIT → người thứ hai phát FeedbackSubmitted{SUCCESS}', () => {
    const first = ok(A, commit);
    const second = ok(B, commit, first);
    const [event, ...rest] = second.pullEvents();
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      type: FEEDBACK_SUBMITTED,
      aggregateType: 'DateFeedback',
      aggregateId: second.id,
      occurredAt: NOW,
      payload: { matchId: MATCH, datePlanId: PLAN, participantIds: [A, B], outcome: 'SUCCESS' },
    });
  });

  it('AC2: B_STOP đầu tiên → phát ngay FeedbackSubmitted{STOPPED}, không chờ người kia', () => {
    const fb = ok(B, stop);
    expect(fb.pullEvents().map((e) => e.payload)).toEqual([
      { matchId: MATCH, datePlanId: PLAN, participantIds: [A, B], outcome: 'STOPPED' },
    ]);
  });

  it('A_COMMIT rồi B_STOP → người thứ hai phát STOPPED', () => {
    const first = ok(A, commit);
    const second = ok(B, stop, first);
    expect(second.pullEvents().map((e) => (e.payload as { outcome: string }).outcome)).toEqual(['STOPPED']);
  });

  it.each([commit, stop])(
    'đã chốt bởi B_STOP trước đó → đánh giá sau chỉ lưu, không phát event',
    (answers) => {
      const first = ok(A, stop);
      const second = ok(B, answers, first);
      expect(second.pullEvents()).toEqual([]);
    },
  );

  it('payload không chứa nội dung đánh giá hay người chọn dừng', () => {
    const fb = ok(B, stop);
    const payload = fb.pullEvents()[0]?.payload;
    expect(Object.keys(payload as object).sort()).toEqual([
      'datePlanId',
      'matchId',
      'outcome',
      'participantIds',
    ]);
  });
});

describe('DateFeedback.submit — luật', () => {
  it('người ngoài cặp → NOT_PARTICIPANT (trước kiểm tra trạng thái lịch)', () => {
    const r = submit(newId(), commit, null, date({ status: 'PROPOSED' }));
    expect(r.isErr() && r.error.code).toBe('NOT_PARTICIPANT');
  });

  it.each<DatePlanStatus>(['PROPOSED', 'DECLINED', 'EXPIRED', 'CANCELLED'])(
    'lịch %s → FEEDBACK_NOT_ALLOWED',
    (status) => {
      const r = submit(A, commit, null, date({ status }));
      expect(r.isErr() && r.error).toEqual({
        code: 'FEEDBACK_NOT_ALLOWED',
        details: { reason: 'DATE_NOT_HAPPENED', status },
      });
    },
  );

  it.each<DatePlanStatus>(['CONFIRMED', 'CHECKED_IN', 'COMPLETED'])(
    'lịch %s đã tới giờ → được đánh giá',
    (status) => {
      expect(submit(A, commit, null, date({ status })).isOk()).toBe(true);
    },
  );

  it('chưa tới giờ bắt đầu → FEEDBACK_NOT_ALLOWED; đúng giờ bắt đầu → được', () => {
    const startsAt = addDuration(NOW, { minutes: 1 });
    const early = submit(A, commit, null, date({ startsAt }));
    expect(early.isErr() && early.error.code).toBe('FEEDBACK_NOT_ALLOWED');
    expect(submit(A, commit, null, date({ startsAt }), startsAt).isOk()).toBe(true);
  });

  it.each([
    [{ rating: 0 }, 'RATING_OUT_OF_RANGE'],
    [{ rating: 6 }, 'RATING_OUT_OF_RANGE'],
    [{ rating: 4.5 }, 'RATING_OUT_OF_RANGE'],
    [{ profileMatch: 'X' }, 'PROFILE_MATCH_INVALID'],
    [{ feeling: 'X' }, 'FEELING_INVALID'],
    [{ decision: 'C' }, 'DECISION_INVALID'],
    [{ stopReasons: ['X'] }, 'STOP_REASON_INVALID'],
    [{ stopReasons: ['NO_SPARK'] }, 'STOP_DETAILS_WITHOUT_STOP'],
    [{ stopNote: 'lý do' }, 'STOP_DETAILS_WITHOUT_STOP'],
  ])('câu trả lời sai %j → FEEDBACK_INVALID{%s}', (over, reason) => {
    const r = submit(A, { ...commit, ...over } as FeedbackAnswers);
    expect(r.isErr() && r.error).toEqual({ code: 'FEEDBACK_INVALID', details: { reason } });
  });

  it('ghi chú trim, rỗng → null; dài quá FEEDBACK_NOTE_MAX_LENGTH code point → NOTE_TOO_LONG', () => {
    expect(ok(A, { ...commit, stopNote: '   ' }).toState().stopNote).toBeNull();
    const max = '😀'.repeat(FEEDBACK_NOTE_MAX_LENGTH);
    expect(ok(A, { ...stop, stopNote: ` ${max} ` }).toState().stopNote).toBe(max);
    const r = submit(A, { ...stop, stopNote: `${max}a` });
    expect(r.isErr() && r.error).toEqual({ code: 'FEEDBACK_INVALID', details: { reason: 'NOTE_TOO_LONG' } });
  });

  it('chuẩn hoá: lý do bỏ trùng, ghi chú trim; cờ khác biệt eKYC theo profileMatch', () => {
    const fb = ok(B, stop);
    expect(fb.toState()).toMatchObject({
      stopReasons: ['NO_SPARK', 'LIFESTYLE_DIFFERENCE'],
      stopNote: 'khác quan điểm',
      subjectId: A,
    });
    expect(fb.flagsAppearanceMismatch).toBe(true);
    expect(ok(A, commit).flagsAppearanceMismatch).toBe(false);
  });

  it('counterpart không phải của người còn lại → throw (lỗi lập trình)', () => {
    const mine = ok(A, commit);
    expect(() => submit(A, commit, mine)).toThrow(/counterpart/);
  });

  it('restore ↔ toState giữ nguyên dữ liệu, không có event', () => {
    const fb = ok(B, stop);
    const again = DateFeedback.restore(fb.toState());
    expect(again.toState()).toEqual(fb.toState());
    expect(again.pullEvents()).toEqual([]);
  });
});
