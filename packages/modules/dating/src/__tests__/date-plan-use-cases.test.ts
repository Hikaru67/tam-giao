import { DATE_RESPONSE_TTL_HOURS } from '@tamgiao/contracts/constants';
import { FakeClock, addDuration, newId } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { DATE_PLAN_EXPIRY_QUEUE } from '../application/date-plan-expiry.js';
import { ExpireDatePlan } from '../application/expire-date-plan.js';
import { GetCurrentDatePlan } from '../application/get-current-date-plan.js';
import { ProposeDate } from '../application/propose-date.js';
import { CancelDate, ConfirmDate, DeclineDate } from '../application/respond-to-date.js';
import {
  FakeMatchingFacade,
  FakePartnerFacade,
  InMemoryDatePlanRepository,
  PassThroughUnitOfWork,
  RecordingScheduler,
} from './dating-fakes.js';

const T0 = new Date('2026-12-01T02:00:00.000Z');
const STARTS = addDuration(T0, { days: 3 });
const ENDS = addDuration(STARTS, { hours: 2 });

function harness() {
  const uow = new PassThroughUnitOfWork();
  const clock = new FakeClock(T0);
  const scheduler = new RecordingScheduler();
  const datePlans = new InMemoryDatePlanRepository();
  const matching = new FakeMatchingFacade();
  const partners = new FakePartnerFacade();
  const a = newId();
  const b = newId();
  const matchId = newId();
  const partnerId = newId();
  matching.setMatch(matchId, a, b, 'DATING');
  partners.active.add(partnerId);
  const base = { uow, clock, datePlans };
  return {
    clock,
    scheduler,
    datePlans,
    matching,
    partners,
    a,
    b,
    matchId,
    partnerId,
    proposeDate: new ProposeDate({ ...base, scheduler, matching, partners }),
    confirmDate: new ConfirmDate({ ...base, matching }),
    declineDate: new DeclineDate(base),
    cancelDate: new CancelDate(base),
    expire: new ExpireDatePlan(base),
    current: new GetCurrentDatePlan({ uow, datePlans, matching }),
  };
}
type Harness = ReturnType<typeof harness>;

const propose = (h: Harness, userId = h.a, overrides: { partnerId?: string; startsAt?: Date } = {}) =>
  h.proposeDate.execute({
    userId,
    partnerId: overrides.partnerId ?? h.partnerId,
    startsAt: overrides.startsAt ?? STARTS,
    endsAt: overrides.startsAt === undefined ? ENDS : addDuration(overrides.startsAt, { hours: 2 }),
    staffBookingRequested: false,
  });

async function proposedId(h: Harness): Promise<string> {
  const r = await propose(h);
  if (r.isErr()) throw new Error(r.error.code);
  return r.value.id;
}

describe('ProposeDate', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('match DATING + quán active → PROPOSED, người kia là invitee, DateProposed + job hết hạn cùng tx', async () => {
    const r = await propose(h);
    if (r.isErr()) throw new Error(r.error.code);
    expect(r.value).toMatchObject({
      matchId: h.matchId,
      inviterId: h.a,
      inviteeId: h.b,
      status: 'PROPOSED',
      expiresAt: addDuration(T0, { hours: DATE_RESPONSE_TTL_HOURS }),
    });
    expect(h.datePlans.eventTypes()).toEqual(['DateProposed']);
    expect(h.scheduler.jobs).toEqual([
      {
        queue: DATE_PLAN_EXPIRY_QUEUE,
        key: `${r.value.id}:1`,
        runAt: r.value.expiresAt,
        payload: { datePlanId: r.value.id },
      },
    ]);
  });

  it.each(['OFFERED', 'AWAITING_RESPONSE', 'MET'] as const)(
    'AC1: match %s → MATCH_NOT_DATING (meta.status)',
    async (status) => {
      h.matching.setMatch(h.matchId, h.a, h.b, status);
      const r = await propose(h);
      expect(r.isErr() && r.error).toEqual({ code: 'MATCH_NOT_DATING', details: { status } });
      expect(h.datePlans.states.size).toBe(0);
      expect(h.scheduler.jobs).toHaveLength(0);
    },
  );

  it('AC1: không có match mở → MATCH_NOT_DATING (status null)', async () => {
    const r = await propose(h, newId());
    expect(r.isErr() && r.error).toEqual({ code: 'MATCH_NOT_DATING', details: { status: null } });
  });

  it('quán không active / không tồn tại → PARTNER_NOT_FOUND; partnerId sai dạng → INVALID_ID', async () => {
    h.partners.active.clear();
    expect(await propose(h)).toMatchObject({ error: { code: 'PARTNER_NOT_FOUND' } });
    const bad = await propose(h, h.a, { partnerId: 'not-a-uuid' });
    expect(bad.isErr() && bad.error.code).toBe('INVALID_ID');
    expect(h.datePlans.states.size).toBe(0);
  });

  it('khung giờ trong quá khứ → DATE_TIME_INVALID', async () => {
    const r = await propose(h, h.a, { startsAt: addDuration(T0, { hours: -1 }) });
    expect(r.isErr() && r.error.code).toBe('DATE_TIME_INVALID');
  });

  it('tối đa 1 lịch đang mở / match: người kia đề xuất tiếp → DATE_ALREADY_OPEN (meta.datePlanId)', async () => {
    const first = await proposedId(h);
    const r = await propose(h, h.b);
    expect(r.isErr() && r.error).toEqual({ code: 'DATE_ALREADY_OPEN', details: { datePlanId: first } });
    expect(h.scheduler.jobs).toHaveLength(1);
  });
});

describe('ConfirmDate / DeclineDate', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('người được mời xác nhận → CONFIRMED + DateConfirmed', async () => {
    const id = await proposedId(h);
    const r = await h.confirmDate.execute({ userId: h.b, datePlanId: id });
    expect(r.isOk() && r.value.status).toBe('CONFIRMED');
    expect(h.datePlans.eventTypes()).toEqual(['DateProposed', 'DateConfirmed']);
  });

  it('người mời tự xác nhận → DATE_NOT_INVITEE; người ngoài → NOT_PARTICIPANT', async () => {
    const id = await proposedId(h);
    const own = await h.confirmDate.execute({ userId: h.a, datePlanId: id });
    expect(own.isErr() && own.error.code).toBe('DATE_NOT_INVITEE');
    const stranger = await h.confirmDate.execute({ userId: newId(), datePlanId: id });
    expect(stranger.isErr() && stranger.error.code).toBe('NOT_PARTICIPANT');
  });

  it('AC1: match rời DATING trước khi xác nhận → MATCH_NOT_DATING, lịch giữ PROPOSED', async () => {
    const id = await proposedId(h);
    h.matching.setMatch(h.matchId, h.a, h.b, 'MET');
    const r = await h.confirmDate.execute({ userId: h.b, datePlanId: id });
    expect(r.isErr() && r.error).toEqual({ code: 'MATCH_NOT_DATING', details: { status: 'MET' } });
    h.matching.clear(h.b);
    const gone = await h.confirmDate.execute({ userId: h.b, datePlanId: id });
    expect(gone.isErr() && gone.error).toEqual({ code: 'MATCH_NOT_DATING', details: { status: null } });
    expect(h.datePlans.states.get(id)?.status).toBe('PROPOSED');
  });

  it('quá hạn (job chưa chạy) → DATE_RESPONSE_EXPIRED', async () => {
    const id = await proposedId(h);
    h.clock.advance({ hours: DATE_RESPONSE_TTL_HOURS });
    const r = await h.confirmDate.execute({ userId: h.b, datePlanId: id });
    expect(r.isErr() && r.error.code).toBe('DATE_RESPONSE_EXPIRED');
  });

  it('id sai dạng → INVALID_ID; không tồn tại → NOT_FOUND', async () => {
    const bad = await h.confirmDate.execute({ userId: h.b, datePlanId: 'x' });
    expect(bad.isErr() && bad.error.code).toBe('INVALID_ID');
    const missing = await h.declineDate.execute({ userId: h.b, datePlanId: newId() });
    expect(missing.isErr() && missing.error.code).toBe('NOT_FOUND');
  });

  it('từ chối → DECLINED, rồi đề xuất lịch mới được', async () => {
    const id = await proposedId(h);
    const r = await h.declineDate.execute({ userId: h.b, datePlanId: id });
    expect(r.isOk() && r.value.status).toBe('DECLINED');
    expect((await propose(h, h.b)).isOk()).toBe(true);
  });
});

describe('CancelDate', () => {
  it('huỷ lịch đã xác nhận trước mốc → CANCELLED; quá mốc → CANCEL_TOO_LATE', async () => {
    const h = harness();
    const id = await proposedId(h);
    await h.confirmDate.execute({ userId: h.b, datePlanId: id });
    h.clock.set(addDuration(STARTS, { hours: -3 }));
    const late = await h.cancelDate.execute({ userId: h.a, datePlanId: id });
    expect(late.isErr() && late.error.code).toBe('CANCEL_TOO_LATE');
    h.clock.set(addDuration(STARTS, { hours: -4 }));
    const r = await h.cancelDate.execute({ userId: h.a, datePlanId: id });
    expect(r.isOk() && r.value).toMatchObject({ status: 'CANCELLED', cancelledBy: h.a });
    expect(h.datePlans.eventTypes()).toEqual(['DateProposed', 'DateConfirmed', 'DateCancelled']);
  });
});

describe('ExpireDatePlan (AC3)', () => {
  it('quá 24h → EXPIRED + DateExpired; chạy lại → ALREADY_RESOLVED; đề xuất lịch mới được', async () => {
    const h = harness();
    const id = await proposedId(h);
    expect(await h.expire.execute({ datePlanId: id })).toEqual({
      kind: 'NOT_YET_EXPIRED',
      status: 'PROPOSED',
    });
    h.clock.advance({ hours: DATE_RESPONSE_TTL_HOURS });
    expect(await h.expire.execute({ datePlanId: id })).toEqual({ kind: 'EXPIRED' });
    expect(await h.expire.execute({ datePlanId: id })).toEqual({
      kind: 'ALREADY_RESOLVED',
      status: 'EXPIRED',
    });
    expect(h.datePlans.eventTypes()).toEqual(['DateProposed', 'DateExpired']);

    const again = await propose(h, h.a, { startsAt: addDuration(STARTS, { days: 1 }) });
    expect(again.isOk() && again.value.status).toBe('PROPOSED');
  });

  it('lịch đã xác nhận → ALREADY_RESOLVED; không có → NOT_FOUND; id sai → throw', async () => {
    const h = harness();
    const id = await proposedId(h);
    await h.confirmDate.execute({ userId: h.b, datePlanId: id });
    h.clock.advance({ days: 2 });
    expect(await h.expire.execute({ datePlanId: id })).toEqual({
      kind: 'ALREADY_RESOLVED',
      status: 'CONFIRMED',
    });
    expect(await h.expire.execute({ datePlanId: newId() })).toEqual({ kind: 'NOT_FOUND' });
    await expect(h.expire.execute({ datePlanId: 'bad' })).rejects.toThrow(/datePlanId/);
  });
});

describe('GetCurrentDatePlan', () => {
  it('không có match mở → null; có → lịch mới nhất (kể cả EXPIRED)', async () => {
    const h = harness();
    expect((await h.current.execute({ userId: newId() })).unwrapOr(null)).toBeNull();
    expect((await h.current.execute({ userId: h.b })).unwrapOr(null)).toBeNull();
    const id = await proposedId(h);
    h.clock.advance({ hours: DATE_RESPONSE_TTL_HOURS });
    await h.expire.execute({ datePlanId: id });
    const current = (await h.current.execute({ userId: h.b })).unwrapOr(null);
    expect(current).toMatchObject({ id, status: 'EXPIRED' });
  });
});
