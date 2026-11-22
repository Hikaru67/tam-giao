import { CHECK_IN_OVERDUE_MINUTES } from '@tamgiao/contracts/constants';
import { addDuration, newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { DatePlan, type CheckInSource } from '../domain/date-plan.js';
import { GeoPoint } from '../domain/geo-point.js';
import { SafetyCheckIn } from '../domain/safety-check-in.js';

const T0 = new Date('2026-12-01T02:00:00.000Z');
const STARTS = addDuration(T0, { days: 3 });
const ENDS = addDuration(STARTS, { hours: 2 });
const DURING = addDuration(STARTS, { minutes: 30 });
const inviter = newId();
const invitee = newId();
const stranger = newId();

function confirmedPlan(): DatePlan {
  const r = DatePlan.propose(
    {
      id: newId<'DatePlan'>(),
      matchId: newId(),
      inviterId: inviter,
      inviteeId: invitee,
      partnerId: newId(),
      startsAt: STARTS,
      endsAt: ENDS,
      staffBookingRequested: false,
    },
    T0,
  );
  if (r.isErr()) throw new Error(r.error.code);
  const plan = r.value;
  expect(plan.confirm(invitee, addDuration(T0, { hours: 1 })).isOk()).toBe(true);
  plan.pullEvents();
  return plan;
}

function start(
  plan: DatePlan,
  at: Date,
  opts: { userId?: string; existing?: SafetyCheckIn | null; source?: CheckInSource; locationShared?: boolean } = {},
) {
  return SafetyCheckIn.start(
    {
      id: newId<'SafetyCheckIn'>(),
      plan,
      existing: opts.existing ?? null,
      userId: opts.userId ?? inviter,
      source: opts.source ?? 'MANUAL',
      locationShared: opts.locationShared ?? false,
    },
    at,
  );
}

function started(plan: DatePlan, at = DURING, userId = inviter): SafetyCheckIn {
  const r = start(plan, at, { userId });
  if (r.isErr()) throw new Error(r.error.code);
  r.value.pullEvents();
  plan.pullEvents();
  return r.value;
}

const codeOf = (r: { isErr(): boolean; error?: unknown }): string => {
  if (!r.isErr()) return 'OK';
  const e = (r as { error: unknown }).error;
  return typeof e === 'string' ? e : (e as { code: string }).code;
};

describe('SafetyCheckIn.start', () => {
  it('người đầu tiên: lịch CONFIRMED → CHECKED_IN (DateCheckedIn) + DateParticipantCheckedIn, overdueAt = endsAt + CHECK_IN_OVERDUE_MINUTES', () => {
    const plan = confirmedPlan();
    const r = start(plan, DURING, { locationShared: true });
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    const checkIn = r.value;
    expect(plan.status).toBe('CHECKED_IN');
    expect(plan.pullEvents().map((e) => [e.type, e.payload])).toEqual([
      [
        'DateCheckedIn',
        expect.objectContaining({ datePlanId: plan.id, checkedInBy: inviter, source: 'MANUAL' }),
      ],
    ]);
    const s = checkIn.toState();
    expect(s.overdueAt).toEqual(addDuration(ENDS, { minutes: CHECK_IN_OVERDUE_MINUTES }));
    expect(s).toMatchObject({ userId: inviter, source: 'MANUAL', checkedInAt: DURING, locationShared: true });
    const [event, ...rest] = checkIn.pullEvents();
    expect(rest).toEqual([]);
    expect(event?.type).toBe('DateParticipantCheckedIn');
    expect(event?.payload).toEqual({
      checkInId: checkIn.id,
      datePlanId: plan.id,
      matchId: plan.matchId,
      userId: inviter,
      partnerId: plan.partnerId,
      source: 'MANUAL',
      checkedInAt: DURING.toISOString(),
      overdueAt: s.overdueAt.toISOString(),
      locationShared: true,
    });
  });

  it('người thứ hai: lịch giữ CHECKED_IN, không phát thêm DateCheckedIn', () => {
    const plan = confirmedPlan();
    started(plan);
    const r = start(plan, addDuration(DURING, { minutes: 5 }), { userId: invitee, source: 'VOUCHER' });
    expect(r.isOk()).toBe(true);
    expect(plan.status).toBe('CHECKED_IN');
    expect(plan.pullEvents()).toEqual([]);
  });

  it('đúng biên startsAt và endsAt được nhận; ngoài khung → DATE_CHECK_IN_WINDOW_CLOSED, lịch không đổi', () => {
    expect(codeOf(start(confirmedPlan(), STARTS))).toBe('OK');
    expect(codeOf(start(confirmedPlan(), ENDS))).toBe('OK');
    const plan = confirmedPlan();
    expect(codeOf(start(plan, addDuration(STARTS, { seconds: -1 })))).toBe('DATE_CHECK_IN_WINDOW_CLOSED');
    expect(codeOf(start(plan, addDuration(ENDS, { seconds: 1 })))).toBe('DATE_CHECK_IN_WINDOW_CLOSED');
    expect(plan.status).toBe('CONFIRMED');
    expect(plan.pullEvents()).toEqual([]);
  });

  it('người ngoài cặp → NOT_PARTICIPANT (trước kiểm tra trạng thái)', () => {
    const r = DatePlan.propose(
      {
        id: newId<'DatePlan'>(),
        matchId: newId(),
        inviterId: inviter,
        inviteeId: invitee,
        partnerId: newId(),
        startsAt: STARTS,
        endsAt: ENDS,
        staffBookingRequested: false,
      },
      T0,
    );
    if (r.isErr()) throw new Error(r.error.code);
    expect(codeOf(start(r.value, DURING, { userId: stranger }))).toBe('NOT_PARTICIPANT');
    expect(codeOf(start(confirmedPlan(), DURING, { userId: stranger }))).toBe('NOT_PARTICIPANT');
  });

  it('lịch PROPOSED / CANCELLED → DATE_INVALID_TRANSITION', () => {
    const r = DatePlan.propose(
      {
        id: newId<'DatePlan'>(),
        matchId: newId(),
        inviterId: inviter,
        inviteeId: invitee,
        partnerId: newId(),
        startsAt: STARTS,
        endsAt: ENDS,
        staffBookingRequested: false,
      },
      T0,
    );
    if (r.isErr()) throw new Error(r.error.code);
    expect(codeOf(start(r.value, DURING))).toBe('DATE_INVALID_TRANSITION');
    const cancelled = confirmedPlan();
    expect(cancelled.cancel(inviter, addDuration(T0, { hours: 2 })).isOk()).toBe(true);
    expect(codeOf(start(cancelled, DURING))).toBe('DATE_INVALID_TRANSITION');
  });

  it('đã có check-in → DATE_ALREADY_CHECKED_IN', () => {
    const plan = confirmedPlan();
    const first = started(plan);
    expect(codeOf(start(plan, DURING, { existing: first }))).toBe('DATE_ALREADY_CHECKED_IN');
  });
});

describe('SafetyCheckIn.checkOut', () => {
  it('check-out → DateParticipantCheckedOut (wasOverdue=false); lần hai → DATE_NOT_CHECKED_IN ALREADY_CHECKED_OUT', () => {
    const checkIn = started(confirmedPlan());
    const at = addDuration(ENDS, { minutes: -10 });
    expect(checkIn.checkOut(at).isOk()).toBe(true);
    expect(checkIn.checkedOutAt).toEqual(at);
    expect(checkIn.pullEvents().map((e) => [e.type, e.payload])).toEqual([
      ['DateParticipantCheckedOut', expect.objectContaining({ checkedOutAt: at.toISOString(), wasOverdue: false })],
    ]);
    const again = checkIn.checkOut(addDuration(at, { minutes: 1 }));
    expect(codeOf(again)).toBe('DATE_NOT_CHECKED_IN');
    expect(again.isErr() && again.error.details).toEqual({ reason: 'ALREADY_CHECKED_OUT' });
  });

  it('check-out sau cảnh báo quá hạn → wasOverdue=true', () => {
    const checkIn = started(confirmedPlan());
    expect(checkIn.markOverdue(checkIn.overdueAt).isOk()).toBe(true);
    checkIn.pullEvents();
    expect(checkIn.checkOut(addDuration(checkIn.overdueAt, { minutes: 5 })).isOk()).toBe(true);
    expect(checkIn.pullEvents()[0]?.payload).toMatchObject({ wasOverdue: true });
  });
});

describe('SafetyCheckIn.markOverdue', () => {
  it('trước overdueAt → NOT_YET_DUE; đúng overdueAt → DateCheckInOverdue; lần hai → ALREADY_ALERTED', () => {
    const checkIn = started(confirmedPlan());
    expect(codeOf(checkIn.markOverdue(addDuration(checkIn.overdueAt, { seconds: -1 })))).toBe('NOT_YET_DUE');
    const r = checkIn.markOverdue(checkIn.overdueAt);
    expect(r.isOk()).toBe(true);
    expect(checkIn.overdueAlertedAt).toEqual(checkIn.overdueAt);
    const events = checkIn.pullEvents();
    expect(events.map((e) => e.type)).toEqual(['DateCheckInOverdue']);
    expect(events[0]?.payload).toEqual({
      checkInId: checkIn.id,
      datePlanId: checkIn.datePlanId,
      matchId: checkIn.toState().matchId,
      userId: inviter,
      partnerId: checkIn.toState().partnerId,
      checkedInAt: DURING.toISOString(),
      endsAt: ENDS.toISOString(),
      overdueAt: checkIn.overdueAt.toISOString(),
    });
    expect(codeOf(checkIn.markOverdue(addDuration(checkIn.overdueAt, { hours: 1 })))).toBe('ALREADY_ALERTED');
    expect(checkIn.pullEvents()).toEqual([]);
  });

  it('đã check-out → CHECKED_OUT, không cảnh báo', () => {
    const checkIn = started(confirmedPlan());
    checkIn.checkOut(ENDS);
    checkIn.pullEvents();
    expect(codeOf(checkIn.markOverdue(checkIn.overdueAt))).toBe('CHECKED_OUT');
    expect(checkIn.pullEvents()).toEqual([]);
  });
});

describe('GeoPoint', () => {
  it('nhận vị trí hợp lệ, serialize ↔ deserialize', () => {
    const r = GeoPoint.create({ latitude: 10.7769, longitude: 106.7009, accuracyMeters: 25 });
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(GeoPoint.deserialize(r.value.serialize())).toEqual(r.value);
    const noAcc = GeoPoint.create({ latitude: -90, longitude: 180 });
    expect(noAcc.isOk() && noAcc.value.accuracyMeters).toBeNull();
  });

  it.each([
    [{ latitude: 91, longitude: 0 }, 'location.latitude'],
    [{ latitude: Number.NaN, longitude: 0 }, 'location.latitude'],
    [{ latitude: 0, longitude: -180.1 }, 'location.longitude'],
    [{ latitude: 0, longitude: 0, accuracyMeters: -1 }, 'location.accuracyMeters'],
  ])('%o → VALIDATION_FAILED %s', (input, field) => {
    const r = GeoPoint.create(input);
    expect(r.isErr() && r.error).toEqual({ code: 'VALIDATION_FAILED', details: { field } });
  });

  it('deserialize dữ liệu hỏng → throw', () => {
    expect(() => GeoPoint.deserialize('{"lat":"x"}')).toThrow();
  });
});
