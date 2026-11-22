import {
  COOLDOWN_DAYS,
  DATING_DAYS,
  OFFER_TTL_HOURS,
  RESPONSE_TTL_HOURS,
} from '@tamgiao/contracts/constants';
import { addDuration, newId } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMatchTransitionEffects } from '../application/responses/match-transition-effects.js';
import type { MatchId } from '../domain/match.js';
import { NOW } from './candidate-fixtures.js';
import { createResponseHarness, type ResponseHarness } from './match-responses-fixtures.js';
import { FAKE_TX } from './slot-fakes.js';

describe('ExpireMatch (job matching.expire-match)', () => {
  let h: ResponseHarness;
  let matchId: MatchId;

  beforeEach(async () => {
    h = createResponseHarness();
    matchId = await h.propose();
    h.scheduler.jobs.length = 0;
  });

  it('AC2: OFFERED quá hạn, job chạy 2 lần → 1 lần chuyển EXPIRED, 1 bộ event, slot trả + pair_history', async () => {
    h.clock.set(addDuration(NOW, { hours: OFFER_TTL_HOURS }));
    const first = await h.expireMatch.execute({ matchId });
    const second = await h.expireMatch.execute({ matchId });

    expect(first).toEqual({ kind: 'EXPIRED', fromStatus: 'OFFERED' });
    expect(second).toEqual({ kind: 'ALREADY_CLOSED', status: 'EXPIRED' });
    expect(h.eventTypes(matchId)).toEqual(['MatchOffered', 'MatchExpired']);
    expect(h.matches.states.get(matchId)).toMatchObject({ status: 'EXPIRED', version: 2 });
    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.pairHistory.get(h.a, h.b)?.outcome).toBe('EXPIRED');
    expect(h.cooldowns.untilByUser.size).toBe(0);
    expect(h.scheduler.jobs).toEqual([]);
  });

  it('job cũ của OFFERED chạy khi match đã AWAITING_RESPONSE với hạn mới → no-op; job mới → EXPIRED', async () => {
    h.clock.advance({ hours: 1 });
    await h.acceptOffer.execute({ userId: h.a });

    h.clock.set(addDuration(NOW, { hours: OFFER_TTL_HOURS }));
    expect(await h.expireMatch.execute({ matchId })).toEqual({
      kind: 'NOT_YET_EXPIRED',
      status: 'AWAITING_RESPONSE',
    });
    expect(h.activeSlots.holderOf(h.a)).toBe(matchId);

    h.clock.set(addDuration(NOW, { hours: 1 + RESPONSE_TTL_HOURS }));
    expect(await h.expireMatch.execute({ matchId })).toEqual({
      kind: 'EXPIRED',
      fromStatus: 'AWAITING_RESPONSE',
    });
    expect(h.eventTypes(matchId)).toEqual(['MatchOffered', 'MatchAwaitingResponse', 'MatchExpired']);
    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.pairHistory.get(h.a, h.b)?.outcome).toBe('EXPIRED');
  });

  it('DATING hết 14 ngày chưa gặp → CLOSED_STOPPED lý do TIMEOUT, không cooldown phạt; chạy lại → no-op (BE-S7-04)', async () => {
    await h.acceptOffer.execute({ userId: h.a });
    await h.acceptOffer.execute({ userId: h.b });
    h.clock.set(addDuration(NOW, { days: DATING_DAYS }));
    const now = h.clock.now();

    expect(await h.expireMatch.execute({ matchId })).toEqual({
      kind: 'CLOSED_STOPPED',
      fromStatus: 'DATING',
    });
    expect(h.matches.states.get(matchId)).toMatchObject({
      status: 'CLOSED_STOPPED',
      closeOutcome: 'STOPPED',
      closeReason: 'TIMEOUT',
      closedAt: now,
    });
    expect(h.cooldowns.untilByUser.size).toBe(0);
    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.pairHistory.get(h.a, h.b)?.outcome).toBe('CLOSED_STOPPED');

    h.clock.advance({ hours: 1 });
    expect(await h.expireMatch.execute({ matchId })).toEqual({
      kind: 'ALREADY_CLOSED',
      status: 'CLOSED_STOPPED',
    });
    expect(h.cooldowns.untilByUser.size).toBe(0);
    expect(h.eventTypes(matchId)).toEqual([
      'MatchOffered',
      'MatchAwaitingResponse',
      'MatchStartedDating',
      'MatchClosed',
    ]);
  });

  it('match không tồn tại → NOT_FOUND (no-op); payload sai id → throw', async () => {
    expect(await h.expireMatch.execute({ matchId: newId() })).toEqual({ kind: 'NOT_FOUND' });
    await expect(h.expireMatch.execute({ matchId: 'not-a-uuid' })).rejects.toThrow();
  });
});

describe('applyMatchTransitionEffects', () => {
  let h: ResponseHarness;
  let matchId: MatchId;

  beforeEach(async () => {
    h = createResponseHarness();
    matchId = await h.propose();
    await h.acceptOffer.execute({ userId: h.a });
    await h.acceptOffer.execute({ userId: h.b });
    h.scheduler.jobs.length = 0;
  });

  it('dừng tìm hiểu (close STOPPED) → cooldown cả hai + trả slot + pair_history', async () => {
    const match = await h.matches.findByIdForUpdate(FAKE_TX, matchId);
    if (match === null) throw new Error('missing');
    const now = h.clock.advance({ days: 2 });
    expect(match.close('STOPPED', now).isOk()).toBe(true);
    await applyMatchTransitionEffects(h.deps, FAKE_TX, match, 'DATING', now);

    const until = addDuration(now, { days: COOLDOWN_DAYS });
    expect(h.cooldowns.untilByUser.get(h.a.toLowerCase())).toEqual(until);
    expect(h.cooldowns.untilByUser.get(h.b.toLowerCase())).toEqual(until);
    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.pairHistory.get(h.a, h.b)?.outcome).toBe('CLOSED_STOPPED');
    expect(h.scheduler.jobs).toEqual([]);
  });

  it('LOCKED → trả slot + pair_history, không cooldown', async () => {
    const match = await h.matches.findByIdForUpdate(FAKE_TX, matchId);
    if (match === null) throw new Error('missing');
    const now = h.clock.now();
    expect(match.lock('REPORT_FILED', now).isOk()).toBe(true);
    await applyMatchTransitionEffects(h.deps, FAKE_TX, match, 'DATING', now);

    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.pairHistory.get(h.a, h.b)?.outcome).toBe('LOCKED');
    expect(h.cooldowns.untilByUser.size).toBe(0);
  });

  it('DATING → MET (vẫn mở, không hạn) và trạng thái không đổi → không làm gì', async () => {
    const match = await h.matches.findByIdForUpdate(FAKE_TX, matchId);
    if (match === null) throw new Error('missing');
    await applyMatchTransitionEffects(h.deps, FAKE_TX, match, 'DATING', h.clock.now());
    expect(match.markMet(h.clock.now()).isOk()).toBe(true);
    await applyMatchTransitionEffects(h.deps, FAKE_TX, match, 'DATING', h.clock.now());

    expect(h.scheduler.jobs).toEqual([]);
    expect(h.activeSlots.holderOf(h.a)).toBe(matchId);
    expect(h.pairHistory.entries.size).toBe(0);
  });
});
