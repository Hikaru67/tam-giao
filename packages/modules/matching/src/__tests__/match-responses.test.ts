import { errorRegistry } from '@tamgiao/contracts';
import { DATING_DAYS, OFFER_TTL_HOURS, RESPONSE_TTL_HOURS } from '@tamgiao/contracts/constants';
import { addDuration, newId, type Result, type Tx } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { MATCH_EXPIRY_QUEUE } from '../application/match-expiry.js';
import type {
  MatchResponseView,
  RespondToMatchError,
} from '../application/responses/respond-to-open-match.js';
import { MATCH_RESPONSE_ERROR_CODES } from '../application/responses/response-errors.js';
import type { Match, MatchId } from '../domain/match.js';
import { NOW } from './candidate-fixtures.js';
import { InMemoryMatchRepository } from './match-fakes.js';
import { createResponseHarness, type ResponseHarness } from './match-responses-fixtures.js';

function valueOf(r: Result<MatchResponseView, RespondToMatchError>): MatchResponseView {
  if (r.isErr()) throw new Error(`expected Ok, got ${r.error.code}`);
  return r.value;
}

function errorOf(r: Result<MatchResponseView, RespondToMatchError>): RespondToMatchError {
  if (r.isOk()) throw new Error('expected Err');
  return r.error;
}

/** `findOpenByUser` trả bản chụp cũ (đọc trước khi job hết hạn commit) — mô phỏng race ở tầng use case. */
class StaleOpenReadRepository extends InMemoryMatchRepository {
  stale: Match | null = null;
  override async findOpenByUser(tx: Tx, userId: string): Promise<Match | null> {
    return this.stale ?? super.findOpenByUser(tx, userId);
  }
}

describe('mã lỗi phản hồi lời ngỏ', () => {
  it('NO_OPEN_MATCH đăng ký 404 bởi matching', () => {
    for (const code of MATCH_RESPONSE_ERROR_CODES) {
      expect(errorRegistry.get(code)?.owner).toBe('matching');
    }
    expect(errorRegistry.statusOf('NO_OPEN_MATCH')).toBe(404);
  });
});

describe('AcceptOffer / DeclineOffer / WithdrawIntro', () => {
  let h: ResponseHarness;
  let matchId: MatchId;

  beforeEach(async () => {
    h = createResponseHarness();
    matchId = await h.propose();
    h.scheduler.jobs.length = 0;
  });

  it('AC1: A đồng ý → AWAITING_RESPONSE (hạn mới 24h, job mới); B đồng ý → DATING (hạn 14 ngày, job mới)', async () => {
    const t1 = h.clock.advance({ hours: 1 });
    const first = valueOf(await h.acceptOffer.execute({ userId: h.a }));
    const awaitingUntil = addDuration(t1, { hours: RESPONSE_TTL_HOURS });
    expect(first).toEqual({ matchId, status: 'AWAITING_RESPONSE', expiresAt: awaitingUntil });
    expect(h.scheduler.jobs).toEqual([
      { queue: MATCH_EXPIRY_QUEUE, key: `${matchId}:2`, runAt: awaitingUntil, payload: { matchId } },
    ]);

    const t2 = h.clock.advance({ hours: 3 });
    const second = valueOf(await h.acceptOffer.execute({ userId: h.b }));
    const datingUntil = addDuration(t2, { days: DATING_DAYS });
    expect(second).toEqual({ matchId, status: 'DATING', expiresAt: datingUntil });
    expect(h.scheduler.jobs[1]).toEqual({
      queue: MATCH_EXPIRY_QUEUE,
      key: `${matchId}:3`,
      runAt: datingUntil,
      payload: { matchId },
    });

    expect(h.eventTypes(matchId)).toEqual(['MatchOffered', 'MatchAwaitingResponse', 'MatchStartedDating']);
    expect(h.matches.states.get(matchId)).toMatchObject({ acceptedBy: [h.a, h.b], datingStartedAt: t2 });
    // DATING vẫn giữ slot, chưa ghi lịch sử cặp.
    expect(h.activeSlots.holderOf(h.a)).toBe(matchId);
    expect(h.activeSlots.holderOf(h.b)).toBe(matchId);
    expect(h.pairHistory.entries.size).toBe(0);
  });

  it('người đã đồng ý bấm lại → ALREADY_RESPONDED, không ghi gì', async () => {
    await h.acceptOffer.execute({ userId: h.a });
    const before = h.matches.events.length;
    expect(errorOf(await h.acceptOffer.execute({ userId: h.a })).code).toBe('ALREADY_RESPONDED');
    expect(errorOf(await h.declineOffer.execute({ userId: h.a })).code).toBe('ALREADY_RESPONDED');
    expect(h.matches.events.length).toBe(before);
    expect(h.scheduler.jobs).toHaveLength(1);
  });

  it('đồng ý đúng lúc hết hạn → OFFER_EXPIRED, không đổi trạng thái, không job', async () => {
    h.clock.advance({ hours: OFFER_TTL_HOURS });
    expect(errorOf(await h.acceptOffer.execute({ userId: h.a })).code).toBe('OFFER_EXPIRED');
    expect(h.matches.states.get(matchId)?.status).toBe('OFFERED');
    expect(h.scheduler.jobs).toEqual([]);
  });

  it('người không có match mở → NO_OPEN_MATCH', async () => {
    expect(errorOf(await h.acceptOffer.execute({ userId: newId() })).code).toBe('NO_OPEN_MATCH');
    expect(errorOf(await h.declineOffer.execute({ userId: newId() })).code).toBe('NO_OPEN_MATCH');
    expect(errorOf(await h.withdrawIntro.execute({ userId: newId() })).code).toBe('NO_OPEN_MATCH');
  });

  it('đang DATING mà bấm đồng ý / bỏ qua → INVALID_TRANSITION', async () => {
    await h.acceptOffer.execute({ userId: h.a });
    await h.acceptOffer.execute({ userId: h.b });
    expect(errorOf(await h.acceptOffer.execute({ userId: h.a })).code).toBe('INVALID_TRANSITION');
    expect(errorOf(await h.declineOffer.execute({ userId: h.b })).code).toBe('INVALID_TRANSITION');
  });

  it('job hết hạn thắng khoá trước (đọc mở cũ) → OFFER_EXPIRED thay vì INVALID_TRANSITION', async () => {
    const stale = new StaleOpenReadRepository();
    h = createResponseHarness(stale);
    matchId = await h.propose();
    stale.stale = await stale.findById({} as Tx, matchId);
    h.clock.advance({ hours: OFFER_TTL_HOURS });
    await h.expireMatch.execute({ matchId });

    const error = errorOf(await h.acceptOffer.execute({ userId: h.a }));
    expect(error.code).toBe('OFFER_EXPIRED');
    expect(h.eventTypes(matchId)).toEqual(['MatchOffered', 'MatchExpired']);
  });

  it('AC3: bỏ qua → DECLINED, slot giải phóng, ghi pair_history, đề xuất lại cặp → PAIR_ALREADY_TRIED', async () => {
    const t1 = h.clock.advance({ hours: 2 });
    const view = valueOf(await h.declineOffer.execute({ userId: h.b, reason: '  Chưa sẵn sàng  ' }));
    expect(view).toEqual({ matchId, status: 'DECLINED', expiresAt: null });
    expect(h.matches.states.get(matchId)).toMatchObject({
      declinedBy: h.b,
      declineReason: 'Chưa sẵn sàng',
      withdrawn: false,
      closedAt: t1,
    });
    expect(h.eventTypes(matchId)).toEqual(['MatchOffered', 'MatchDeclined']);
    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.pairHistory.get(h.a, h.b)).toEqual({ outcome: 'DECLINED', matchId, updatedAt: t1 });
    expect(h.cooldowns.untilByUser.size).toBe(0);
    expect(h.scheduler.jobs).toEqual([]);

    const again = await h.proposeMatch.execute({
      staffId: newId(),
      userAId: h.b,
      userBId: h.a,
      staffNote: null,
    });
    expect(again.isErr() && again.error.code).toBe('PAIR_ALREADY_TRIED');
  });

  it('bỏ qua với lý do rỗng → lưu null', async () => {
    valueOf(await h.declineOffer.execute({ userId: h.a, reason: '   ' }));
    expect(h.matches.states.get(matchId)?.declineReason).toBeNull();
  });

  it('bên chưa đồng ý bỏ qua khi AWAITING_RESPONSE → DECLINED + giải phóng slot', async () => {
    await h.acceptOffer.execute({ userId: h.a });
    valueOf(await h.declineOffer.execute({ userId: h.b }));
    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.pairHistory.get(h.a, h.b)?.outcome).toBe('DECLINED');
  });

  it('rút lời ngỏ: người đã đồng ý → DECLINED{withdrawn}, slot giải phóng, pair_history', async () => {
    await h.acceptOffer.execute({ userId: h.a });
    h.clock.advance({ hours: 5 });
    const view = valueOf(await h.withdrawIntro.execute({ userId: h.a }));
    expect(view.status).toBe('DECLINED');
    expect(h.matches.states.get(matchId)).toMatchObject({ withdrawn: true, declinedBy: h.a });
    expect(h.eventTypes(matchId)).toEqual(['MatchOffered', 'MatchAwaitingResponse', 'MatchDeclined']);
    expect(h.activeSlots.slots.size).toBe(0);
    expect(h.pairHistory.get(h.a, h.b)?.outcome).toBe('DECLINED');
  });

  it('rút lời ngỏ: bên chưa đồng ý hoặc đang OFFERED → INVALID_TRANSITION, không đổi gì', async () => {
    expect(errorOf(await h.withdrawIntro.execute({ userId: h.a })).code).toBe('INVALID_TRANSITION');
    await h.acceptOffer.execute({ userId: h.a });
    expect(errorOf(await h.withdrawIntro.execute({ userId: h.b })).code).toBe('INVALID_TRANSITION');
    expect(h.matches.states.get(matchId)?.status).toBe('AWAITING_RESPONSE');
    expect(h.activeSlots.holderOf(h.a)).toBe(matchId);
  });

  it('rút lời ngỏ sau hạn chờ phản hồi → OFFER_EXPIRED', async () => {
    await h.acceptOffer.execute({ userId: h.a });
    h.clock.set(new Date(NOW.getTime() + RESPONSE_TTL_HOURS * 3_600_000));
    expect(errorOf(await h.withdrawIntro.execute({ userId: h.a })).code).toBe('OFFER_EXPIRED');
  });
});
