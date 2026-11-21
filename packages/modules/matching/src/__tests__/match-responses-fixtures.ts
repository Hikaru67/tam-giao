import { FakeClock, newId } from '@tamgiao/kernel';
import { ProposeMatch } from '../application/propose-match.js';
import { AcceptOffer } from '../application/responses/accept-offer.js';
import { DeclineOffer } from '../application/responses/decline-offer.js';
import { ExpireMatch } from '../application/responses/expire-match.js';
import type { MatchResponseDeps } from '../application/responses/respond-to-open-match.js';
import { WithdrawIntro } from '../application/responses/withdraw-intro.js';
import type { MatchId } from '../domain/match.js';
import { candidate, NOW } from './candidate-fixtures.js';
import {
  FakeVerification,
  InMemoryCandidateProfileReader,
  InMemoryMatchRepository,
  PassThroughUnitOfWork,
  RecordingAuditLogger,
  RecordingScheduler,
} from './match-fakes.js';
import {
  InMemoryActiveSlotRepository,
  InMemoryCooldownRepository,
  InMemoryPairHistoryRepository,
} from './slot-fakes.js';

/** Bộ fake + use case phản hồi lời ngỏ / hết hạn dùng chung cho unit test BE-S5-05. */
export function createResponseHarness(matches: InMemoryMatchRepository = new InMemoryMatchRepository()) {
  const a = newId();
  const b = newId();
  const clock = new FakeClock(NOW);
  const uow = new PassThroughUnitOfWork();
  const verification = new FakeVerification();
  verification.verified.add(a).add(b);
  const profiles = new InMemoryCandidateProfileReader();
  profiles.profiles.set(a, candidate(a, { gender: 'male' }));
  profiles.profiles.set(b, candidate(b, { gender: 'female' }));
  const cooldowns = new InMemoryCooldownRepository();
  const pairHistory = new InMemoryPairHistoryRepository();
  const activeSlots = new InMemoryActiveSlotRepository();
  const scheduler = new RecordingScheduler();
  const deps: MatchResponseDeps = { uow, clock, matches, activeSlots, pairHistory, cooldowns, scheduler };

  const proposeMatch = new ProposeMatch({
    uow,
    clock,
    verification,
    profiles,
    cooldowns,
    pairHistory,
    activeSlots,
    matches,
    scheduler,
    auditLogger: new RecordingAuditLogger(),
  });

  /** Chuyên viên đề xuất cặp (a, b) lúc `NOW` → trả id match `OFFERED`. */
  const propose = async (): Promise<MatchId> => {
    const result = await proposeMatch.execute({ staffId: newId(), userAId: a, userBId: b, staffNote: null });
    if (result.isErr()) throw new Error(result.error.code);
    return result.value.matchId as MatchId;
  };

  return {
    a,
    b,
    clock,
    matches,
    cooldowns,
    pairHistory,
    activeSlots,
    scheduler,
    deps,
    proposeMatch,
    propose,
    acceptOffer: new AcceptOffer(deps),
    declineOffer: new DeclineOffer(deps),
    withdrawIntro: new WithdrawIntro(deps),
    expireMatch: new ExpireMatch(deps),
    eventTypes: (matchId: string) =>
      matches.events.filter((e) => e.aggregateId === matchId).map((e) => e.type),
  };
}

export type ResponseHarness = ReturnType<typeof createResponseHarness>;
