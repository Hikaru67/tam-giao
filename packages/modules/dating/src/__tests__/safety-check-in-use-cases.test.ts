import { CHECK_IN_LOCATION_RETENTION_HOURS, CHECK_IN_OVERDUE_MINUTES } from '@tamgiao/contracts/constants';
import { FakeClock, addDuration, newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { CHECK_IN_LOCATION_PURGE_QUEUE, CHECK_IN_OVERDUE_QUEUE } from '../application/check-in-jobs.js';
import {
  CheckInOnVoucherRedeemed,
  MarkCheckInOverdue,
  PurgeCheckInLocations,
} from '../application/check-in-worker-jobs.js';
import { CheckInToDate, CheckOutOfDate, GetMyCheckIn } from '../application/safety-check-in.js';
import { DatePlan } from '../domain/date-plan.js';
import {
  InMemoryCheckInLocationStore,
  InMemoryDatePlanRepository,
  InMemorySafetyCheckInRepository,
  PassThroughUnitOfWork,
  RecordingScheduler,
} from './dating-fakes.js';

const T0 = new Date('2026-12-01T02:00:00.000Z');
const STARTS = addDuration(T0, { days: 3 });
const ENDS = addDuration(STARTS, { hours: 2 });
const DURING = addDuration(STARTS, { minutes: 20 });
const LOCATION = { latitude: 10.7769, longitude: 106.7009, accuracyMeters: 30 };
const tx = {} as never;

async function harness() {
  const uow = new PassThroughUnitOfWork();
  const clock = new FakeClock(T0);
  const scheduler = new RecordingScheduler();
  const datePlans = new InMemoryDatePlanRepository();
  const checkIns = new InMemorySafetyCheckInRepository();
  const locations = new InMemoryCheckInLocationStore();
  const a = newId();
  const b = newId();
  const partnerId = newId();
  const proposed = DatePlan.propose(
    {
      id: newId<'DatePlan'>(),
      matchId: newId(),
      inviterId: a,
      inviteeId: b,
      partnerId,
      startsAt: STARTS,
      endsAt: ENDS,
      staffBookingRequested: false,
    },
    T0,
  );
  if (proposed.isErr()) throw new Error(proposed.error.code);
  const plan = proposed.value;
  plan.confirm(b, addDuration(T0, { hours: 1 }));
  await datePlans.save(tx, plan);
  datePlans.events.length = 0;
  clock.set(DURING);
  return {
    clock,
    scheduler,
    datePlans,
    checkIns,
    locations,
    a,
    b,
    partnerId,
    planId: plan.id as string,
    checkIn: new CheckInToDate({ uow, clock, scheduler, datePlans, checkIns, locations }),
    checkOut: new CheckOutOfDate({ uow, clock, datePlans, checkIns }),
    getMine: new GetMyCheckIn({ uow, datePlans, checkIns }),
    overdue: new MarkCheckInOverdue({ uow, clock, checkIns }),
    purge: new PurgeCheckInLocations({ uow, clock, locations }),
    voucher: new CheckInOnVoucherRedeemed({ scheduler, datePlans, checkIns }),
  };
}

const errorOf = (r: { isErr(): boolean }) => (r.isErr() ? (r as unknown as { error: unknown }).error : null);

describe('CheckInToDate', () => {
  it('check-in có vị trí: lưu check-in + vị trí, lịch CHECKED_IN, hẹn job quá hạn + job xoá vị trí', async () => {
    const h = await harness();
    const r = await h.checkIn.execute({ userId: h.a, datePlanId: h.planId, location: LOCATION });
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    const overdueAt = addDuration(ENDS, { minutes: CHECK_IN_OVERDUE_MINUTES });
    expect(r.value).toMatchObject({ source: 'MANUAL', checkedInAt: DURING, overdueAt, locationShared: true });
    expect(h.datePlans.states.get(h.planId)?.status).toBe('CHECKED_IN');
    expect(h.datePlans.eventTypes()).toEqual(['DateCheckedIn']);
    expect(h.checkIns.eventTypes()).toEqual(['DateParticipantCheckedIn']);
    const purgeAfter = addDuration(DURING, { hours: CHECK_IN_LOCATION_RETENTION_HOURS });
    expect(h.locations.rows.get(r.value.id)).toMatchObject({ recordedAt: DURING, purgeAfter });
    expect(h.scheduler.jobs).toEqual([
      { queue: CHECK_IN_LOCATION_PURGE_QUEUE, key: r.value.id, runAt: purgeAfter, payload: { checkInId: r.value.id } },
      { queue: CHECK_IN_OVERDUE_QUEUE, key: r.value.id, runAt: overdueAt, payload: { checkInId: r.value.id } },
    ]);
  });

  it('không gửi vị trí → không lưu vị trí, không hẹn job xoá', async () => {
    const h = await harness();
    const r = await h.checkIn.execute({ userId: h.b, datePlanId: h.planId });
    expect(r.isOk() && r.value.locationShared).toBe(false);
    expect(h.locations.rows.size).toBe(0);
    expect(h.scheduler.jobs.map((j) => j.queue)).toEqual([CHECK_IN_OVERDUE_QUEUE]);
  });

  it('vị trí sai → VALIDATION_FAILED trước khi chạm DB; id sai → INVALID_ID; lịch không có → NOT_FOUND', async () => {
    const h = await harness();
    const bad = await h.checkIn.execute({
      userId: h.a,
      datePlanId: h.planId,
      location: { latitude: 0, longitude: 200 },
    });
    expect(errorOf(bad)).toEqual({ code: 'VALIDATION_FAILED', details: { field: 'location.longitude' } });
    expect(errorOf(await h.checkIn.execute({ userId: h.a, datePlanId: 'x' }))).toMatchObject({ code: 'INVALID_ID' });
    expect(errorOf(await h.checkIn.execute({ userId: h.a, datePlanId: newId() }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(h.checkIns.states.size).toBe(0);
  });

  it('ngoài khung giờ hẹn → DATE_CHECK_IN_WINDOW_CLOSED, không lưu vị trí (chỉ nhận vị trí trong khung giờ)', async () => {
    const h = await harness();
    h.clock.set(addDuration(STARTS, { minutes: -1 }));
    const early = await h.checkIn.execute({ userId: h.a, datePlanId: h.planId, location: LOCATION });
    expect(errorOf(early)).toMatchObject({ code: 'DATE_CHECK_IN_WINDOW_CLOSED' });
    h.clock.set(addDuration(ENDS, { seconds: 1 }));
    const late = await h.checkIn.execute({ userId: h.a, datePlanId: h.planId, location: LOCATION });
    expect(errorOf(late)).toMatchObject({ code: 'DATE_CHECK_IN_WINDOW_CLOSED' });
    expect(h.locations.rows.size).toBe(0);
    expect(h.scheduler.jobs).toEqual([]);
  });

  it('người ngoài cặp → NOT_PARTICIPANT; check-in lần hai → DATE_ALREADY_CHECKED_IN', async () => {
    const h = await harness();
    expect(errorOf(await h.checkIn.execute({ userId: newId(), datePlanId: h.planId }))).toMatchObject({
      code: 'NOT_PARTICIPANT',
    });
    await h.checkIn.execute({ userId: h.a, datePlanId: h.planId });
    expect(errorOf(await h.checkIn.execute({ userId: h.a, datePlanId: h.planId }))).toMatchObject({
      code: 'DATE_ALREADY_CHECKED_IN',
    });
    expect(h.checkIns.states.size).toBe(1);
  });
});

describe('CheckOutOfDate / GetMyCheckIn', () => {
  it('chưa check-in → DATE_NOT_CHECKED_IN NOT_CHECKED_IN; check-out được; lần hai → ALREADY_CHECKED_OUT', async () => {
    const h = await harness();
    expect(errorOf(await h.checkOut.execute({ userId: h.a, datePlanId: h.planId }))).toEqual({
      code: 'DATE_NOT_CHECKED_IN',
      details: { reason: 'NOT_CHECKED_IN' },
    });
    const none = await h.getMine.execute({ userId: h.a, datePlanId: h.planId });
    expect(none.isOk() && none.value).toBeNull();
    await h.checkIn.execute({ userId: h.a, datePlanId: h.planId });
    h.clock.advance({ hours: 1 });
    const out = await h.checkOut.execute({ userId: h.a, datePlanId: h.planId });
    expect(out.isOk() && out.value.checkedOutAt).toEqual(h.clock.now());
    expect(errorOf(await h.checkOut.execute({ userId: h.a, datePlanId: h.planId }))).toEqual({
      code: 'DATE_NOT_CHECKED_IN',
      details: { reason: 'ALREADY_CHECKED_OUT' },
    });
    const mine = await h.getMine.execute({ userId: h.a, datePlanId: h.planId });
    expect(mine.isOk() && mine.value?.checkedOutAt).toEqual(h.clock.now());
  });

  it('người ngoài cặp → NOT_PARTICIPANT; lịch không có → NOT_FOUND', async () => {
    const h = await harness();
    expect(errorOf(await h.checkOut.execute({ userId: newId(), datePlanId: h.planId }))).toMatchObject({
      code: 'NOT_PARTICIPANT',
    });
    expect(errorOf(await h.getMine.execute({ userId: newId(), datePlanId: h.planId }))).toMatchObject({
      code: 'NOT_PARTICIPANT',
    });
    expect(errorOf(await h.checkOut.execute({ userId: h.a, datePlanId: newId() }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('MarkCheckInOverdue (AC2)', () => {
  it('quá endsAt + CHECK_IN_OVERDUE_MINUTES chưa check-out → cảnh báo đúng một lần', async () => {
    const h = await harness();
    const r = await h.checkIn.execute({ userId: h.a, datePlanId: h.planId });
    if (r.isErr()) throw new Error(r.error.code);
    const payload = { checkInId: r.value.id };
    h.clock.set(addDuration(ENDS, { minutes: CHECK_IN_OVERDUE_MINUTES - 1 }));
    expect(await h.overdue.execute(payload)).toEqual({ kind: 'NOT_YET_DUE' });
    h.clock.set(addDuration(ENDS, { minutes: CHECK_IN_OVERDUE_MINUTES }));
    expect(await h.overdue.execute(payload)).toEqual({ kind: 'ALERTED' });
    expect(await h.overdue.execute(payload)).toEqual({ kind: 'ALREADY_ALERTED' });
    expect(h.checkIns.eventTypes().filter((t) => t === 'DateCheckInOverdue')).toHaveLength(1);
  });

  it('đã check-out → CHECKED_OUT; không có check-in → NOT_FOUND; id sai → throw', async () => {
    const h = await harness();
    const r = await h.checkIn.execute({ userId: h.a, datePlanId: h.planId });
    if (r.isErr()) throw new Error(r.error.code);
    await h.checkOut.execute({ userId: h.a, datePlanId: h.planId });
    h.clock.set(addDuration(ENDS, { hours: 3 }));
    expect(await h.overdue.execute({ checkInId: r.value.id })).toEqual({ kind: 'CHECKED_OUT' });
    expect(h.checkIns.eventTypes()).not.toContain('DateCheckInOverdue');
    expect(await h.overdue.execute({ checkInId: newId() })).toEqual({ kind: 'NOT_FOUND' });
    await expect(h.overdue.execute({ checkInId: 'bad' })).rejects.toThrow();
  });
});

describe('PurgeCheckInLocations (AC1)', () => {
  it('xoá vị trí đúng CHECK_IN_LOCATION_RETENTION_HOURS giờ sau khi ghi nhận; chạy lại không đổi', async () => {
    const h = await harness();
    await h.checkIn.execute({ userId: h.a, datePlanId: h.planId, location: LOCATION });
    h.clock.set(addDuration(DURING, { hours: CHECK_IN_LOCATION_RETENTION_HOURS, seconds: -1 }));
    expect(await h.purge.execute()).toEqual({ purged: 0 });
    expect(h.locations.rows.size).toBe(1);
    h.clock.set(addDuration(DURING, { hours: CHECK_IN_LOCATION_RETENTION_HOURS }));
    expect(await h.purge.execute()).toEqual({ purged: 1 });
    expect(h.locations.rows.size).toBe(0);
    expect(await h.purge.execute()).toEqual({ purged: 0 });
  });
});

describe('CheckInOnVoucherRedeemed', () => {
  it('quét voucher trong khung giờ tại đúng quán → check-in nguồn VOUCHER lúc quét + job quá hạn; giao lại → no-op', async () => {
    const h = await harness();
    h.clock.set(addDuration(ENDS, { minutes: 30 })); // consumer xử lý trễ — dùng giờ quét, không dùng giờ xử lý
    const cmd = { userId: h.a, partnerId: h.partnerId, redeemedAt: DURING };
    const first = await h.voucher.handle(tx, cmd);
    expect(first).toMatchObject({ kind: 'CHECKED_IN', datePlanId: h.planId });
    const [state] = [...h.checkIns.states.values()];
    expect(state).toMatchObject({ source: 'VOUCHER', checkedInAt: DURING, locationShared: false });
    expect(h.datePlans.states.get(h.planId)?.status).toBe('CHECKED_IN');
    expect(h.scheduler.jobs.map((j) => j.queue)).toEqual([CHECK_IN_OVERDUE_QUEUE]);
    expect(await h.voucher.handle(tx, cmd)).toMatchObject({ kind: 'ALREADY_CHECKED_IN' });
    expect(h.checkIns.states.size).toBe(1);
  });

  it('đã check-in thủ công → ALREADY_CHECKED_IN', async () => {
    const h = await harness();
    await h.checkIn.execute({ userId: h.a, datePlanId: h.planId });
    const r = await h.voucher.handle(tx, { userId: h.a, partnerId: h.partnerId, redeemedAt: DURING });
    expect(r.kind).toBe('ALREADY_CHECKED_IN');
  });

  it('ngoài khung giờ / quán khác / người khác → NO_DATE_PLAN', async () => {
    const h = await harness();
    const outside = addDuration(ENDS, { minutes: 1 });
    expect(await h.voucher.handle(tx, { userId: h.a, partnerId: h.partnerId, redeemedAt: outside })).toEqual({
      kind: 'NO_DATE_PLAN',
    });
    expect(await h.voucher.handle(tx, { userId: h.a, partnerId: newId(), redeemedAt: DURING })).toEqual({
      kind: 'NO_DATE_PLAN',
    });
    expect(await h.voucher.handle(tx, { userId: newId(), partnerId: h.partnerId, redeemedAt: DURING })).toEqual({
      kind: 'NO_DATE_PLAN',
    });
    expect(h.checkIns.states.size).toBe(0);
  });
});
