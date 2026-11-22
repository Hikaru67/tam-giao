import { DATING_DAYS } from '@tamgiao/contracts/constants';
import { addDuration, newId } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { MarkMatchMet } from '../application/responses/mark-match-met.js';
import type { MatchId } from '../domain/match.js';
import { createResponseHarness, type ResponseHarness } from './match-responses-fixtures.js';
import { FAKE_TX } from './slot-fakes.js';

describe('MarkMatchMet (consumer DateCompleted, BE-S7-04)', () => {
  let h: ResponseHarness;
  let markMet: MarkMatchMet;
  let matchId: MatchId;
  const run = (id: string = matchId) => markMet.executeIn(FAKE_TX, { matchId: id });

  beforeEach(async () => {
    h = createResponseHarness();
    markMet = new MarkMatchMet(h.deps);
    matchId = await h.propose();
  });

  async function startDating(): Promise<void> {
    await h.acceptOffer.execute({ userId: h.a });
    await h.acceptOffer.execute({ userId: h.b });
    h.scheduler.jobs.length = 0;
  }

  it('DATING → MET: bỏ hạn, MatchMet, giữ slot, không job, không cooldown; giao lại → NOT_DATING no-op', async () => {
    await startDating();
    const now = h.clock.advance({ days: 5 });

    expect(await run()).toEqual({ kind: 'MET' });
    expect(h.matches.states.get(matchId)).toMatchObject({ status: 'MET', metAt: now, expiresAt: null });
    expect(h.eventTypes(matchId)).toEqual([
      'MatchOffered',
      'MatchAwaitingResponse',
      'MatchStartedDating',
      'MatchMet',
    ]);
    expect(h.activeSlots.slots.size).toBe(2);
    expect(h.scheduler.jobs).toEqual([]);
    expect(h.cooldowns.untilByUser.size).toBe(0);

    expect(await run()).toEqual({ kind: 'NOT_DATING', status: 'MET' });
    expect(h.eventTypes(matchId)).toHaveLength(4);
  });

  it('đã MET thì job hết hạn DATING cũ chạy lúc hết DATING_DAYS → no-op (không đóng match)', async () => {
    await startDating();
    h.clock.advance({ days: 3 });
    await run();
    h.clock.set(addDuration(h.clock.now(), { days: DATING_DAYS }));

    expect(await h.expireMatch.execute({ matchId })).toEqual({ kind: 'ALREADY_CLOSED', status: 'MET' });
    expect(h.matches.states.get(matchId)?.status).toBe('MET');
  });

  it('match đã đóng vì hết hạn (TIMEOUT) → NOT_DATING, không mở lại', async () => {
    await startDating();
    h.clock.advance({ days: DATING_DAYS });
    await h.expireMatch.execute({ matchId });

    expect(await run()).toEqual({ kind: 'NOT_DATING', status: 'CLOSED_STOPPED' });
    expect(h.matches.states.get(matchId)?.status).toBe('CLOSED_STOPPED');
  });

  it('match chưa tới DATING (OFFERED) → NOT_DATING', async () => {
    expect(await run()).toEqual({ kind: 'NOT_DATING', status: 'OFFERED' });
  });

  it('không có match → NOT_FOUND; matchId sai dạng → throw', async () => {
    expect(await run(newId())).toEqual({ kind: 'NOT_FOUND' });
    await expect(run('not-a-uuid')).rejects.toThrow();
  });
});
