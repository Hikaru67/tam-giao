import { COOLDOWN_DAYS } from '@tamgiao/contracts/constants';
import { addDuration, newId } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { CloseMatch } from '../application/use-cases/close-match.js';
import type { MatchId } from '../domain/match.js';
import { createResponseHarness, type ResponseHarness } from './match-responses-fixtures.js';
import { FAKE_TX } from './slot-fakes.js';

describe('CloseMatch (consumer FeedbackSubmitted, BE-S7-03)', () => {
  let h: ResponseHarness;
  let closeMatch: CloseMatch;
  let matchId: MatchId;
  const close = (outcome: 'SUCCESS' | 'STOPPED', id: string = matchId) =>
    closeMatch.executeIn(FAKE_TX, { matchId: id, outcome });

  const startDating = async () => {
    await h.acceptOffer.execute({ userId: h.a });
    await h.acceptOffer.execute({ userId: h.b });
    h.scheduler.jobs.length = 0;
  };
  const markMet = async () => {
    const m = await h.matches.findById(FAKE_TX, matchId);
    m?.markMet(h.clock.now());
    if (m) await h.matches.save(FAKE_TX, m);
  };

  beforeEach(async () => {
    h = createResponseHarness();
    closeMatch = new CloseMatch(h.deps);
    matchId = await h.propose();
    h.scheduler.jobs.length = 0;
  });

  it('AC1: MET + SUCCESS → CLOSED_SUCCESS, trả slot, pair_history, KHÔNG cooldown', async () => {
    await startDating();
    await markMet();
    h.clock.advance({ hours: 3 });

    expect(await close('SUCCESS')).toEqual({ kind: 'CLOSED', fromStatus: 'MET', status: 'CLOSED_SUCCESS' });
    expect(h.matches.states.get(matchId)).toMatchObject({
      status: 'CLOSED_SUCCESS',
      closeOutcome: 'SUCCESS',
      closedAt: h.clock.now(),
    });
    expect(h.eventTypes(matchId).slice(-2)).toEqual(['MatchMet', 'MatchClosed']);
    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.pairHistory.get(h.a, h.b)?.outcome).toBe('CLOSED_SUCCESS');
    expect(h.cooldowns.untilByUser.size).toBe(0);
    expect(h.scheduler.jobs).toEqual([]);
  });

  it('AC2: STOPPED → CLOSED_STOPPED, cooldown COOLDOWN_DAYS cho cả hai người', async () => {
    await startDating();
    await markMet();

    expect(await close('STOPPED')).toEqual({ kind: 'CLOSED', fromStatus: 'MET', status: 'CLOSED_STOPPED' });
    const until = addDuration(h.clock.now(), { days: COOLDOWN_DAYS });
    expect(h.cooldowns.untilByUser.get(h.a)).toEqual(until);
    expect(h.cooldowns.untilByUser.get(h.b)).toEqual(until);
    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.pairHistory.get(h.a, h.b)?.outcome).toBe('CLOSED_STOPPED');
  });

  it.each([
    ['SUCCESS', 'CLOSED_SUCCESS'],
    ['STOPPED', 'CLOSED_STOPPED'],
  ] as const)('DATING (chưa markMet) + %s → MatchMet rồi MatchClosed → %s', async (outcome, status) => {
    await startDating();
    expect(await close(outcome)).toEqual({ kind: 'CLOSED', fromStatus: 'DATING', status });
    expect(h.eventTypes(matchId).slice(-3)).toEqual(['MatchStartedDating', 'MatchMet', 'MatchClosed']);
    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.cooldowns.untilByUser.size).toBe(outcome === 'STOPPED' ? 2 : 0);
  });

  it('giao lại event (A9): lần 2 → ALREADY_CLOSED, không event / hiệu ứng mới', async () => {
    await startDating();
    await close('STOPPED');
    const events = h.eventTypes(matchId).length;
    const cooldowns = new Map(h.cooldowns.untilByUser);
    h.clock.advance({ days: 1 });
    expect(await close('STOPPED')).toEqual({ kind: 'ALREADY_CLOSED', status: 'CLOSED_STOPPED' });
    expect(h.eventTypes(matchId)).toHaveLength(events);
    expect(h.cooldowns.untilByUser).toEqual(cooldowns);
  });

  it('match chưa DATING (OFFERED / AWAITING_RESPONSE) → NOT_DATING, không đổi gì', async () => {
    expect(await close('SUCCESS')).toEqual({ kind: 'NOT_DATING', status: 'OFFERED' });
    await h.acceptOffer.execute({ userId: h.a });
    expect(await close('STOPPED')).toEqual({ kind: 'NOT_DATING', status: 'AWAITING_RESPONSE' });
    expect(h.matches.states.get(matchId)?.status).toBe('AWAITING_RESPONSE');
  });

  it('match đã đóng trước (DECLINED) → ALREADY_CLOSED; không có match → NOT_FOUND; id sai → throw', async () => {
    await h.declineOffer.execute({ userId: h.a, reason: null });
    expect(await close('SUCCESS')).toEqual({ kind: 'ALREADY_CLOSED', status: 'DECLINED' });
    expect(await close('SUCCESS', newId())).toEqual({ kind: 'NOT_FOUND' });
    await expect(close('SUCCESS', 'not-a-uuid')).rejects.toThrow(/matchId/);
  });
});
