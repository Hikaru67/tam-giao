import { addDuration, FakeClock, newId, type Result } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { GetFeedbackDetail, ListAppearanceFlags } from '../application/feedback-admin.js';
import { GetMyFeedback, SubmitFeedback } from '../application/submit-feedback.js';
import type { FeedbackAnswers } from '../domain/date-feedback.js';
import { DatePlan } from '../domain/date-plan.js';
import { InMemoryDatePlanRepository, PassThroughUnitOfWork } from './dating-fakes.js';
import { InMemoryFeedbackRepository, RecordingAuditLogger } from './feedback-fakes.js';

const T0 = new Date('2026-12-01T02:00:00.000Z');
const STARTS = addDuration(T0, { days: 2 });
const TX = {} as never;

const must = <T, E extends { code: string }>(r: Result<T, E>): T => {
  if (r.isErr()) throw new Error(r.error.code);
  return r.value;
};

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
  stopReasons: ['NO_SPARK'],
  stopNote: 'ghi chú kín',
};

describe('SubmitFeedback / GetMyFeedback (BE-S7-03)', () => {
  let clock: FakeClock;
  let datePlans: InMemoryDatePlanRepository;
  let feedbacks: InMemoryFeedbackRepository;
  let submit: SubmitFeedback;
  let getMine: GetMyFeedback;
  let a: string;
  let b: string;
  let matchId: string;
  let planId: string;

  beforeEach(async () => {
    clock = new FakeClock(T0);
    datePlans = new InMemoryDatePlanRepository();
    feedbacks = new InMemoryFeedbackRepository();
    const uow = new PassThroughUnitOfWork();
    submit = new SubmitFeedback({ uow, clock, datePlans, feedbacks });
    getMine = new GetMyFeedback({ uow, datePlans, feedbacks });
    a = newId();
    b = newId();
    matchId = newId();
    const plan = must(
      DatePlan.propose(
        {
          id: newId<'DatePlan'>(),
          matchId,
          inviterId: a,
          inviteeId: b,
          partnerId: newId(),
          startsAt: STARTS,
          endsAt: addDuration(STARTS, { hours: 2 }),
          staffBookingRequested: false,
        },
        T0,
      ),
    );
    must(plan.confirm(b, T0));
    await datePlans.save(TX, plan);
    planId = plan.id;
    clock.set(addDuration(STARTS, { hours: 3 }));
  });

  const send = (userId: string, answers: FeedbackAnswers, id: string = planId) =>
    submit.execute({ userId, datePlanId: id, answers });

  it('AC1: hai A_COMMIT → một FeedbackSubmitted{SUCCESS}; khoá theo match trước khi đọc', async () => {
    expect((await send(a, commit)).isOk()).toBe(true);
    expect(feedbacks.events).toEqual([]);
    const second = await send(b, commit);
    expect(second.isOk() && second.value).toMatchObject({ authorId: b, subjectId: a, decision: 'A_COMMIT' });
    expect(feedbacks.events.map((e) => e.payload)).toEqual([
      { matchId, datePlanId: planId, participantIds: [a, b], outcome: 'SUCCESS' },
    ]);
    expect(feedbacks.lockedMatches).toEqual([matchId, matchId]);
  });

  it('AC2: một bên B_STOP → FeedbackSubmitted{STOPPED} ngay; người kia vẫn gửi được, không phát lại', async () => {
    await send(a, stop);
    expect(feedbacks.events.map((e) => (e.payload as { outcome: string }).outcome)).toEqual(['STOPPED']);
    expect((await send(b, commit)).isOk()).toBe(true);
    expect(feedbacks.events).toHaveLength(1);
    expect(feedbacks.states.size).toBe(2);
  });

  it('gửi lại → FEEDBACK_ALREADY_SUBMITTED, không đổi gì', async () => {
    await send(a, commit);
    const again = await send(a, stop);
    expect(again.isErr() && again.error.code).toBe('FEEDBACK_ALREADY_SUBMITTED');
    expect(feedbacks.states.size).toBe(1);
    expect(feedbacks.events).toEqual([]);
  });

  it('chưa tới giờ hẹn → FEEDBACK_NOT_ALLOWED', async () => {
    clock.set(addDuration(STARTS, { minutes: -1 }));
    const r = await send(a, commit);
    expect(r.isErr() && r.error.code).toBe('FEEDBACK_NOT_ALLOWED');
  });

  it('id sai → INVALID_ID; không có lịch → NOT_FOUND; người ngoài → NOT_PARTICIPANT (không khoá)', async () => {
    const bad = await send(a, commit, 'x');
    expect(bad.isErr() && bad.error.code).toBe('INVALID_ID');
    const missing = await send(a, commit, newId());
    expect(missing.isErr() && missing.error.code).toBe('NOT_FOUND');
    const outsider = await send(newId(), commit);
    expect(outsider.isErr() && outsider.error.code).toBe('NOT_PARTICIPANT');
    expect(feedbacks.lockedMatches).toEqual([]);
  });

  it('câu trả lời sai → FEEDBACK_INVALID', async () => {
    const r = await send(a, { ...commit, rating: 9 });
    expect(r.isErr() && r.error.code).toBe('FEEDBACK_INVALID');
  });

  it('AC3: GetMyFeedback chỉ trả đánh giá của chính người xem, không lộ của đối phương', async () => {
    await send(a, stop);
    const mineA = await getMine.execute({ userId: a, datePlanId: planId });
    expect(mineA.isOk() && mineA.value).toMatchObject({ authorId: a, stopNote: 'ghi chú kín' });
    const forB = await getMine.execute({ userId: b, datePlanId: planId });
    expect(forB.isOk() && forB.value).toBeNull();
    const outsider = await getMine.execute({ userId: newId(), datePlanId: planId });
    expect(outsider.isErr() && outsider.error.code).toBe('NOT_PARTICIPANT');
  });
});

describe('Admin: ListAppearanceFlags / GetFeedbackDetail', () => {
  it('hàng chờ chỉ có đánh giá "Có khác biệt"; xem chi tiết ghi audit, audit lỗi → throw', async () => {
    const uow = new PassThroughUnitOfWork();
    const clock = new FakeClock(T0);
    const datePlans = new InMemoryDatePlanRepository();
    const feedbacks = new InMemoryFeedbackRepository();
    const auditLogger = new RecordingAuditLogger();
    const a = newId();
    const b = newId();
    const plan = must(
      DatePlan.propose(
        {
          id: newId<'DatePlan'>(),
          matchId: newId(),
          inviterId: a,
          inviteeId: b,
          partnerId: newId(),
          startsAt: STARTS,
          endsAt: addDuration(STARTS, { hours: 1 }),
          staffBookingRequested: false,
        },
        T0,
      ),
    );
    must(plan.confirm(b, T0));
    await datePlans.save(TX, plan);
    clock.set(addDuration(STARTS, { hours: 2 }));
    const submit = new SubmitFeedback({ uow, clock, datePlans, feedbacks });
    await submit.execute({ userId: a, datePlanId: plan.id, answers: commit });
    const flagged = await submit.execute({ userId: b, datePlanId: plan.id, answers: stop });
    const flaggedId = flagged.isOk() ? flagged.value.id : '';

    const page = await new ListAppearanceFlags({ uow, feedbacks }).execute({ limit: 500 });
    expect(must(page)).toEqual({
      total: 1,
      items: [
        {
          feedbackId: flaggedId,
          matchId: plan.matchId,
          datePlanId: plan.id,
          authorId: b,
          subjectId: a,
          submittedAt: clock.now(),
        },
      ],
    });

    const detail = new GetFeedbackDetail({ uow, feedbacks, auditLogger });
    const actor = { adminId: newId(), ip: '10.0.0.1' };
    const r = await detail.execute({ feedbackId: flaggedId, actor });
    expect(r.isOk() && r.value.stopNote).toBe('ghi chú kín');
    expect(auditLogger.entries).toEqual([
      {
        actor: { type: 'admin', id: actor.adminId },
        action: 'dating.feedback.view_detail',
        targetType: 'dating_feedback',
        targetId: flaggedId,
        ip: '10.0.0.1',
        meta: { matchId: plan.matchId, authorId: b, subjectId: a },
      },
    ]);

    const missing = await detail.execute({ feedbackId: newId(), actor });
    expect(missing.isErr() && missing.error.code).toBe('FEEDBACK_NOT_FOUND');
    const bad = await detail.execute({ feedbackId: 'nope', actor });
    expect(bad.isErr() && bad.error.code).toBe('INVALID_ID');
    auditLogger.reject = true;
    await expect(detail.execute({ feedbackId: flaggedId, actor })).rejects.toThrow(/audit/);
  });
});
