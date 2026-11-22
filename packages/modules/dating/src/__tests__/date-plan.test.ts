import { DATE_CANCEL_CUTOFF_HOURS, DATE_RESPONSE_TTL_HOURS } from '@tamgiao/contracts/constants';
import { addDuration, newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { DatePlan } from '../domain/date-plan.js';

const T0 = new Date('2026-12-01T02:00:00.000Z');
const STARTS = addDuration(T0, { days: 3 });
const ENDS = addDuration(STARTS, { hours: 2 });
const inviter = newId();
const invitee = newId();
const stranger = newId();
const matchId = newId();
const partnerId = newId();

function propose(overrides: { startsAt?: Date; endsAt?: Date } = {}) {
  return DatePlan.propose(
    {
      id: newId<'DatePlan'>(),
      matchId,
      inviterId: inviter,
      inviteeId: invitee,
      partnerId,
      startsAt: overrides.startsAt ?? STARTS,
      endsAt: overrides.endsAt ?? ENDS,
      staffBookingRequested: true,
    },
    T0,
  );
}

function proposed(): DatePlan {
  const r = propose();
  if (r.isErr()) throw new Error(r.error.code);
  r.value.pullEvents();
  return r.value;
}

function confirmed(): DatePlan {
  const plan = proposed();
  expect(plan.confirm(invitee, addDuration(T0, { hours: 1 })).isOk()).toBe(true);
  plan.pullEvents();
  return plan;
}

const codeOf = (r: { isErr(): boolean; error?: { code: string } }) =>
  r.isErr() ? (r as { error: { code: string } }).error.code : 'OK';

describe('DatePlan.propose', () => {
  it('PROPOSED, hạn xác nhận = now + DATE_RESPONSE_TTL_HOURS, phát DateProposed (không PII)', () => {
    const r = propose();
    if (r.isErr()) throw new Error(r.error.code);
    const plan = r.value;
    expect(plan.status).toBe('PROPOSED');
    expect(plan.version).toBe(1);
    expect(plan.expiresAt).toEqual(addDuration(T0, { hours: DATE_RESPONSE_TTL_HOURS }));
    const [event] = plan.pullEvents();
    expect(event?.type).toBe('DateProposed');
    expect(event?.payload).toEqual({
      datePlanId: plan.id,
      matchId,
      inviterId: inviter,
      inviteeId: invitee,
      partnerId,
      startsAt: STARTS.toISOString(),
      endsAt: ENDS.toISOString(),
      staffBookingRequested: true,
      expiresAt: plan.expiresAt.toISOString(),
    });
  });

  it('giờ bắt đầu sớm hơn hạn 24h → hạn xác nhận = giờ bắt đầu', () => {
    const startsAt = addDuration(T0, { hours: 5 });
    const r = propose({ startsAt, endsAt: addDuration(startsAt, { hours: 1 }) });
    expect(r.isOk() && r.value.expiresAt).toEqual(startsAt);
  });

  it('giờ bắt đầu không sau now → DATE_TIME_INVALID STARTS_IN_PAST', () => {
    const r = propose({ startsAt: T0, endsAt: addDuration(T0, { hours: 1 }) });
    expect(r.isErr() && r.error).toEqual({
      code: 'DATE_TIME_INVALID',
      details: { reason: 'STARTS_IN_PAST' },
    });
  });

  it('giờ kết thúc không sau giờ bắt đầu → DATE_TIME_INVALID ENDS_BEFORE_START', () => {
    const r = propose({ endsAt: STARTS });
    expect(r.isErr() && r.error).toEqual({
      code: 'DATE_TIME_INVALID',
      details: { reason: 'ENDS_BEFORE_START' },
    });
  });

  it('cùng một người mời chính mình → throw (lỗi lập trình)', () => {
    expect(() =>
      DatePlan.propose(
        {
          id: newId<'DatePlan'>(),
          matchId,
          inviterId: inviter,
          inviteeId: inviter.toUpperCase(),
          partnerId,
          startsAt: STARTS,
          endsAt: ENDS,
          staffBookingRequested: false,
        },
        T0,
      ),
    ).toThrow();
  });
});

describe('DatePlan.confirm / decline', () => {
  it('người được mời xác nhận trong hạn → CONFIRMED + DateConfirmed', () => {
    const plan = proposed();
    const at = addDuration(T0, { hours: 2 });
    expect(plan.confirm(invitee, at).isOk()).toBe(true);
    expect(plan.status).toBe('CONFIRMED');
    expect(plan.toState().respondedAt).toEqual(at);
    const [event] = plan.pullEvents();
    expect(event?.type).toBe('DateConfirmed');
    expect(event?.payload).toMatchObject({ inviterId: inviter, inviteeId: invitee, partnerId });
  });

  it('người được mời từ chối → DECLINED + DateDeclined', () => {
    const plan = proposed();
    expect(plan.decline(invitee, addDuration(T0, { hours: 2 })).isOk()).toBe(true);
    expect(plan.status).toBe('DECLINED');
    expect(plan.isOpen()).toBe(false);
    expect(plan.pullEvents().map((e) => e.type)).toEqual(['DateDeclined']);
  });

  it('người ngoài → NOT_PARTICIPANT (trước mọi kiểm tra khác); người mời → DATE_NOT_INVITEE', () => {
    const plan = proposed();
    const at = addDuration(T0, { days: 5 });
    expect(codeOf(plan.confirm(stranger, at))).toBe('NOT_PARTICIPANT');
    expect(codeOf(plan.decline(stranger, at))).toBe('NOT_PARTICIPANT');
    expect(codeOf(plan.confirm(inviter, T0))).toBe('DATE_NOT_INVITEE');
    expect(codeOf(plan.decline(inviter, T0))).toBe('DATE_NOT_INVITEE');
    expect(plan.status).toBe('PROPOSED');
  });

  it('đúng/qua hạn xác nhận → DATE_RESPONSE_EXPIRED; ngay trước hạn vẫn được', () => {
    const plan = proposed();
    expect(codeOf(plan.confirm(invitee, plan.expiresAt))).toBe('DATE_RESPONSE_EXPIRED');
    expect(codeOf(plan.decline(invitee, plan.expiresAt))).toBe('DATE_RESPONSE_EXPIRED');
    expect(plan.confirm(invitee, addDuration(plan.expiresAt, { milliseconds: -1 })).isOk()).toBe(true);
  });

  it('không còn PROPOSED → DATE_INVALID_TRANSITION', () => {
    const plan = confirmed();
    expect(plan.confirm(invitee, T0)).toMatchObject({
      error: { code: 'DATE_INVALID_TRANSITION', details: { action: 'confirm', status: 'CONFIRMED' } },
    });
    expect(codeOf(plan.decline(invitee, T0))).toBe('DATE_INVALID_TRANSITION');
  });
});

describe('DatePlan.cancel', () => {
  it('CONFIRMED, đúng biên startsAt − DATE_CANCEL_CUTOFF_HOURS → CANCELLED + DateCancelled', () => {
    const plan = confirmed();
    const deadline = addDuration(STARTS, { hours: -DATE_CANCEL_CUTOFF_HOURS });
    expect(plan.cancelDeadline).toEqual(deadline);
    expect(plan.cancel(inviter, deadline).isOk()).toBe(true);
    expect(plan.status).toBe('CANCELLED');
    expect(plan.toState()).toMatchObject({ cancelledAt: deadline, cancelledBy: inviter });
    const [event] = plan.pullEvents();
    expect(event?.type).toBe('DateCancelled');
    expect(event?.payload).toMatchObject({ cancelledBy: inviter, startsAt: STARTS.toISOString() });
  });

  it('người được mời cũng huỷ được', () => {
    const plan = confirmed();
    expect(plan.cancel(invitee, T0).isOk()).toBe(true);
  });

  it('quá mốc huỷ (dù 1ms) → CANCEL_TOO_LATE, giữ CONFIRMED', () => {
    const plan = confirmed();
    const r = plan.cancel(inviter, addDuration(plan.cancelDeadline, { milliseconds: 1 }));
    expect(r.isErr() && r.error).toEqual({
      code: 'CANCEL_TOO_LATE',
      details: { cancelDeadline: plan.cancelDeadline.toISOString() },
    });
    expect(plan.status).toBe('CONFIRMED');
  });

  it('người ngoài → NOT_PARTICIPANT; lịch chưa xác nhận → DATE_INVALID_TRANSITION', () => {
    expect(codeOf(confirmed().cancel(stranger, T0))).toBe('NOT_PARTICIPANT');
    expect(codeOf(proposed().cancel(inviter, T0))).toBe('DATE_INVALID_TRANSITION');
  });
});

describe('DatePlan.expire', () => {
  it('PROPOSED tới hạn → EXPIRED + DateExpired', () => {
    const plan = proposed();
    expect(plan.expire(plan.expiresAt).isOk()).toBe(true);
    expect(plan.status).toBe('EXPIRED');
    expect(plan.isOpen()).toBe(false);
    expect(plan.pullEvents().map((e) => e.type)).toEqual(['DateExpired']);
  });

  it('chưa tới hạn → DATE_INVALID_TRANSITION not_expired', () => {
    const plan = proposed();
    const r = plan.expire(addDuration(plan.expiresAt, { milliseconds: -1 }));
    expect(r.isErr() && r.error.details).toMatchObject({ reason: 'not_expired' });
    expect(plan.status).toBe('PROPOSED');
  });

  it('đã xác nhận → DATE_INVALID_TRANSITION, giữ nguyên', () => {
    const plan = confirmed();
    expect(codeOf(plan.expire(addDuration(T0, { days: 10 })))).toBe('DATE_INVALID_TRANSITION');
    expect(plan.status).toBe('CONFIRMED');
  });
});

describe('DatePlan.markCompleted', () => {
  it('CONFIRMED → COMPLETED + 1 event DateCompleted có matchId và completedAt', () => {
    const plan = confirmed();
    const at = addDuration(STARTS, { hours: 1 });
    const r = plan.markCompleted(at);
    expect(r.isOk()).toBe(true);
    expect(plan.status).toBe('COMPLETED');
    expect(plan.toState().updatedAt).toEqual(at);
    const events = plan.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('DateCompleted');
    expect(events[0]?.payload).toEqual({
      datePlanId: plan.id,
      matchId,
      inviterId: inviter,
      inviteeId: invitee,
      completedAt: at.toISOString(),
    });
  });

  it('CHECKED_IN → COMPLETED', () => {
    const plan = confirmed();
    expect(plan.markCheckedIn(inviter, 'MANUAL', STARTS).isOk()).toBe(true);
    plan.pullEvents();
    expect(plan.status).toBe('CHECKED_IN');
    const at = addDuration(STARTS, { hours: 1 });
    expect(plan.markCompleted(at).isOk()).toBe(true);
    expect(plan.status).toBe('COMPLETED');
    expect(plan.pullEvents().map((e) => e.type)).toEqual(['DateCompleted']);
  });

  it('COMPLETED → no-op không phát event', () => {
    const plan = confirmed();
    const at = addDuration(STARTS, { hours: 1 });
    expect(plan.markCompleted(at).isOk()).toBe(true);
    plan.pullEvents();
    expect(plan.markCompleted(addDuration(at, { hours: 1 })).isOk()).toBe(true);
    expect(plan.status).toBe('COMPLETED');
    expect(plan.pullEvents()).toEqual([]);
  });

  it('PROPOSED, DECLINED, EXPIRED, CANCELLED → DATE_INVALID_TRANSITION', () => {
    expect(codeOf(proposed().markCompleted(STARTS))).toBe('DATE_INVALID_TRANSITION');

    const declinedPlan = proposed();
    expect(declinedPlan.decline(invitee, addDuration(T0, { hours: 1 })).isOk()).toBe(true);
    expect(codeOf(declinedPlan.markCompleted(STARTS))).toBe('DATE_INVALID_TRANSITION');

    const expiredPlan = proposed();
    expect(expiredPlan.expire(expiredPlan.expiresAt).isOk()).toBe(true);
    expect(codeOf(expiredPlan.markCompleted(STARTS))).toBe('DATE_INVALID_TRANSITION');

    const cancelledPlan = confirmed();
    expect(cancelledPlan.cancel(inviter, cancelledPlan.cancelDeadline).isOk()).toBe(true);
    expect(codeOf(cancelledPlan.markCompleted(STARTS))).toBe('DATE_INVALID_TRANSITION');
  });
});
