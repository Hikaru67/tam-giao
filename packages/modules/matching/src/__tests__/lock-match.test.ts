import { newId } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { MatchPairLookup } from '../application/match-pair-lookup.js';
import { LockMatch, MATCH_LOCK_REASON_REPORT_FILED } from '../application/responses/lock-match.js';
import type { MatchId } from '../domain/match.js';
import { PassThroughUnitOfWork } from './match-fakes.js';
import { createResponseHarness, type ResponseHarness } from './match-responses-fixtures.js';
import { FAKE_TX } from './slot-fakes.js';

describe('LockMatch (consumer ReportFiled)', () => {
  let h: ResponseHarness;
  let lockMatch: LockMatch;
  let matchId: MatchId;
  const lock = (id: string = matchId) =>
    lockMatch.executeIn(FAKE_TX, { matchId: id, reason: MATCH_LOCK_REASON_REPORT_FILED });

  beforeEach(async () => {
    h = createResponseHarness();
    lockMatch = new LockMatch(h.deps);
    matchId = await h.propose();
    h.scheduler.jobs.length = 0;
  });

  it('DATING → LOCKED: MatchLocked, trả slot hai người, pair_history LOCKED, không cooldown, không job', async () => {
    await h.acceptOffer.execute({ userId: h.a });
    await h.acceptOffer.execute({ userId: h.b });
    h.scheduler.jobs.length = 0;
    h.clock.advance({ days: 3 });

    expect(await lock()).toEqual({ kind: 'LOCKED', fromStatus: 'DATING' });
    expect(h.matches.states.get(matchId)).toMatchObject({
      status: 'LOCKED',
      lockReason: 'REPORT_FILED',
      expiresAt: null,
      closedAt: h.clock.now(),
    });
    expect(h.eventTypes(matchId)).toEqual([
      'MatchOffered',
      'MatchAwaitingResponse',
      'MatchStartedDating',
      'MatchLocked',
    ]);
    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.pairHistory.get(h.a, h.b)?.outcome).toBe('LOCKED');
    expect(h.cooldowns.untilByUser.size).toBe(0);
    expect(h.scheduler.jobs).toEqual([]);
  });

  it.each(['OFFERED', 'AWAITING_RESPONSE', 'MET'] as const)('%s (mở) → LOCKED', async (status) => {
    if (status !== 'OFFERED') await h.acceptOffer.execute({ userId: h.a });
    if (status === 'MET') {
      await h.acceptOffer.execute({ userId: h.b });
      const m = await h.matches.findById(FAKE_TX, matchId);
      m?.markMet(h.clock.now());
      if (m) await h.matches.save(FAKE_TX, m);
    }
    expect(await lock()).toEqual({ kind: 'LOCKED', fromStatus: status });
    expect(h.activeSlots.slots.size).toBe(0);
  });

  it('giao lại event (idempotent, A9): lần 2 → ALREADY_CLOSED, không event / hiệu ứng mới', async () => {
    await lock();
    const events = h.eventTypes(matchId).length;
    expect(await lock()).toEqual({ kind: 'ALREADY_CLOSED', status: 'LOCKED' });
    expect(h.eventTypes(matchId)).toHaveLength(events);
  });

  it('match đã đóng (DECLINED) → ALREADY_CLOSED, giữ nguyên trạng thái', async () => {
    await h.declineOffer.execute({ userId: h.a, reason: null });
    expect(await lock()).toEqual({ kind: 'ALREADY_CLOSED', status: 'DECLINED' });
    expect(h.matches.states.get(matchId)?.status).toBe('DECLINED');
    expect(h.eventTypes(matchId)).toEqual(['MatchOffered', 'MatchDeclined']);
  });

  it('không có match → NOT_FOUND; matchId sai dạng → throw (lỗi lập trình)', async () => {
    expect(await lock(newId())).toEqual({ kind: 'NOT_FOUND' });
    await expect(lock('not-a-uuid')).rejects.toThrow(/matchId/);
  });
});

describe('MatchPairLookup (facade findLatestMatchBetween)', () => {
  it('trả match gần nhất giữa hai người bất kể thứ tự / trạng thái; người lạ hoặc chính mình → null', async () => {
    const h = createResponseHarness();
    const facade = new MatchPairLookup({ uow: new PassThroughUnitOfWork(), matches: h.matches });
    const matchId = await h.propose();

    expect(await facade.findLatestMatchBetween(h.b, h.a)).toEqual({
      matchId,
      status: 'OFFERED',
      isOpen: true,
    });
    await h.declineOffer.execute({ userId: h.a, reason: null });
    expect(await facade.findLatestMatchBetween(h.a, h.b)).toEqual({
      matchId,
      status: 'DECLINED',
      isOpen: false,
    });
    expect(await facade.findLatestMatchBetween(h.a, newId())).toBeNull();
    expect(await facade.findLatestMatchBetween(h.a, h.a)).toBeNull();
    expect(await facade.findLatestMatchBetween(h.a, 'not-a-uuid')).toBeNull();
  });

  it('findOpenMatchForUser (BE-S7-01): match mở của từng người trong cặp; đóng / người lạ / id sai → null', async () => {
    const h = createResponseHarness();
    const facade = new MatchPairLookup({ uow: new PassThroughUnitOfWork(), matches: h.matches });
    const matchId = await h.propose();

    const expected = { matchId, status: 'OFFERED', participantIds: [h.a, h.b] };
    expect(await facade.findOpenMatchForUser(h.a)).toEqual(expected);
    expect(await facade.findOpenMatchForUser(h.b)).toEqual(expected);
    expect(await facade.findOpenMatchForUser(newId())).toBeNull();
    expect(await facade.findOpenMatchForUser('not-a-uuid')).toBeNull();

    await h.declineOffer.execute({ userId: h.a, reason: null });
    expect(await facade.findOpenMatchForUser(h.a)).toBeNull();
  });
});
