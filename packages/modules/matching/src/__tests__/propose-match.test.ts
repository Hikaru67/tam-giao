import { errorRegistry } from '@tamgiao/contracts';
import { OFFER_TTL_HOURS } from '@tamgiao/contracts/constants';
import { FakeClock, newId, type Result } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { MATCH_EXPIRY_QUEUE } from '../application/match-expiry.js';
import { orderPair } from '../application/ports/pair-history-repository.js';
import {
  MATCH_PROPOSE_AUDIT_ACTION,
  ProposeMatch,
  type ProposeMatchCommand,
  type ProposeMatchError,
} from '../application/propose-match.js';
import { CompatibilityScorer } from '../domain/compatibility-scorer.js';
import type { MatchId } from '../domain/match.js';
import { PROPOSE_MATCH_ERROR_CODES } from '../domain/propose-errors.js';
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

function errorOf<T>(r: Result<T, ProposeMatchError>): ProposeMatchError {
  if (r.isOk()) throw new Error('expected Err');
  return r.error;
}

describe('ProposeMatch', () => {
  const staffId = newId();
  let a: string;
  let b: string;
  let uow: PassThroughUnitOfWork;
  let verification: FakeVerification;
  let profiles: InMemoryCandidateProfileReader;
  let cooldowns: InMemoryCooldownRepository;
  let pairHistory: InMemoryPairHistoryRepository;
  let activeSlots: InMemoryActiveSlotRepository;
  let matches: InMemoryMatchRepository;
  let scheduler: RecordingScheduler;
  let auditLogger: RecordingAuditLogger;
  let useCase: ProposeMatch;

  const cmd = (over: Partial<ProposeMatchCommand> = {}): ProposeMatchCommand => ({
    staffId,
    userAId: a,
    userBId: b,
    staffNote: 'Hai bạn cùng yêu thích đọc sách',
    ip: '10.0.0.1',
    ...over,
  });

  const expectNothingWritten = () => {
    expect(matches.states.size).toBe(0);
    expect(matches.events).toEqual([]);
    expect(scheduler.jobs).toEqual([]);
    expect(auditLogger.entries).toEqual([]);
    expect(activeSlots.slots.size).toBe(0);
  };

  beforeEach(() => {
    a = newId();
    b = newId();
    uow = new PassThroughUnitOfWork();
    verification = new FakeVerification();
    verification.verified.add(a).add(b);
    profiles = new InMemoryCandidateProfileReader();
    profiles.profiles.set(a, candidate(a, { gender: 'male' }));
    profiles.profiles.set(b, candidate(b, { gender: 'female' }));
    cooldowns = new InMemoryCooldownRepository();
    pairHistory = new InMemoryPairHistoryRepository();
    activeSlots = new InMemoryActiveSlotRepository();
    matches = new InMemoryMatchRepository();
    scheduler = new RecordingScheduler();
    auditLogger = new RecordingAuditLogger();
    useCase = new ProposeMatch({
      uow,
      clock: new FakeClock(NOW),
      verification,
      profiles,
      cooldowns,
      pairHistory,
      activeSlots,
      matches,
      scheduler,
      auditLogger,
    });
  });

  it('thành công → match OFFERED + giữ slot hai người + MatchOffered + job hết hạn + audit (không ghi staffNote)', async () => {
    const result = await useCase.execute(cmd());
    if (result.isErr()) throw new Error(result.error.code);
    const view = result.value;
    const expiresAt = new Date(NOW.getTime() + OFFER_TTL_HOURS * 3_600_000);
    const expectedScore = new CompatibilityScorer().score(
      candidate(a, { gender: 'male' }),
      candidate(b, { gender: 'female' }),
      NOW,
    );

    expect(view).toEqual({
      matchId: view.matchId,
      status: 'OFFERED',
      participantIds: [a, b],
      scoreSnapshot: { total: expectedScore.total, pillars: expectedScore.pillars },
      expiresAt,
    });
    const state = matches.states.get(view.matchId);
    expect(state).toMatchObject({
      status: 'OFFERED',
      participants: [a, b],
      createdBy: staffId,
      staffNote: 'Hai bạn cùng yêu thích đọc sách',
      expiresAt,
      version: 1,
    });
    expect(matches.events).toEqual([{ type: 'MatchOffered', aggregateId: view.matchId, version: 1 }]);
    expect(activeSlots.holderOf(a)).toBe(view.matchId);
    expect(activeSlots.holderOf(b)).toBe(view.matchId);
    expect(scheduler.jobs).toEqual([
      {
        queue: MATCH_EXPIRY_QUEUE,
        key: `${view.matchId}:1`,
        runAt: expiresAt,
        payload: { matchId: view.matchId },
      },
    ]);
    expect(auditLogger.entries).toEqual([
      {
        actor: { type: 'admin', id: staffId },
        action: MATCH_PROPOSE_AUDIT_ACTION,
        targetType: 'match',
        targetId: view.matchId,
        ip: '10.0.0.1',
        meta: { participantIds: [a, b], scoreTotal: expectedScore.total, hasStaffNote: true },
      },
    ]);
    expect(JSON.stringify(auditLogger.entries)).not.toContain('đọc sách');
  });

  it('ghi chú rỗng / toàn khoảng trắng → lưu null', async () => {
    const result = await useCase.execute(cmd({ staffNote: '   ' }));
    if (result.isErr()) throw new Error(result.error.code);
    expect(matches.states.get(result.value.matchId)?.staffNote).toBeNull();
    expect(auditLogger.entries[0]?.meta).toMatchObject({ hasStaffNote: false });
  });

  it('AC1: một người đang bận → USER_BUSY, không tạo match, không lên lịch job, không giữ slot người kia', async () => {
    const otherMatch = newId<'Match'>();
    await activeSlots.claim({} as never, [b], otherMatch, NOW);

    const error = errorOf(await useCase.execute(cmd()));

    expect(error).toEqual({ code: 'USER_BUSY', details: { userIds: [b] } });
    expect(matches.states.size).toBe(0);
    expect(matches.events).toEqual([]);
    expect(scheduler.jobs).toEqual([]);
    expect(auditLogger.entries).toEqual([]);
    expect(activeSlots.holderOf(a)).toBeUndefined();
    expect(activeSlots.holderOf(b)).toBe(otherMatch);
  });

  it('một người đang cooldown → USER_COOLING_DOWN', async () => {
    await cooldowns.start({} as never, a, new Date(NOW.getTime() + 1), NOW);
    expect(errorOf(await useCase.execute(cmd()))).toEqual({
      code: 'USER_COOLING_DOWN',
      details: { userIds: [a] },
    });
    expectNothingWritten();
  });

  it('cooldown đã hết đúng tại `until` → đề xuất được', async () => {
    await cooldowns.start({} as never, b, NOW, NOW);
    expect((await useCase.execute(cmd())).isOk()).toBe(true);
  });

  it('cặp đã từng thử (bất kể thứ tự) → PAIR_ALREADY_TRIED', async () => {
    const [low, high] = orderPair(a, b);
    await pairHistory.record({} as never, high, low, 'DECLINED', newId(), NOW);
    expect(errorOf(await useCase.execute(cmd()))).toEqual({ code: 'PAIR_ALREADY_TRIED' });
    expectNothingWritten();
  });

  it('chưa xác thực → USER_NOT_VERIFIED (liệt kê người chưa duyệt), không mở transaction', async () => {
    verification.verified.delete(b);
    expect(errorOf(await useCase.execute(cmd()))).toEqual({
      code: 'USER_NOT_VERIFIED',
      details: { userIds: [b] },
    });
    expect(uow.runs).toBe(0);
    expectNothingWritten();
  });

  it('cùng một người (kể cả khác hoa/thường) → MATCH_SAME_USER', async () => {
    expect(errorOf(await useCase.execute(cmd({ userBId: a.toUpperCase() })))).toEqual({
      code: 'MATCH_SAME_USER',
    });
    expect(uow.runs).toBe(0);
  });

  it('id không phải UUID v7 → INVALID_ID', async () => {
    expect(errorOf(await useCase.execute(cmd({ userBId: 'abc' })))).toEqual({ code: 'INVALID_ID' });
  });

  it('chưa có hồ sơ trong read model → CANDIDATE_PROFILE_NOT_FOUND', async () => {
    profiles.profiles.delete(a);
    expect(errorOf(await useCase.execute(cmd()))).toEqual({
      code: 'CANDIDATE_PROFILE_NOT_FOUND',
      details: { userIds: [a] },
    });
    expectNothingWritten();
  });

  it.each([
    ['cùng giới', { gender: 'male' as const }],
    ['B ngoài khoảng tuổi A muốn', { gender: 'female' as const, birthDate: '1980-01-15' }],
  ])('vi phạm bộ lọc cứng (%s) → HARD_FILTER_MISMATCH', async (_name, over) => {
    profiles.profiles.set(b, candidate(b, over));
    expect(errorOf(await useCase.execute(cmd()))).toEqual({ code: 'HARD_FILTER_MISMATCH' });
    expectNothingWritten();
  });

  it('audit bị từ chối → throw (UnitOfWork rollback)', async () => {
    auditLogger.failWith = 'AUDIT_ENTRY_INVALID';
    await expect(useCase.execute(cmd())).rejects.toThrow(/match.propose/);
  });

  it('match vừa tạo được tìm thấy qua findOpenByUser cho cả hai người', async () => {
    const result = await useCase.execute(cmd());
    if (result.isErr()) throw new Error(result.error.code);
    const id = result.value.matchId as MatchId;
    expect((await matches.findOpenByUser({} as never, a))?.id).toBe(id);
    expect((await matches.findOpenByUser({} as never, b))?.id).toBe(id);
  });
});

describe('mã lỗi ProposeMatch', () => {
  it.each(PROPOSE_MATCH_ERROR_CODES)('%s đã đăng ký trong contracts bởi matching', (code) => {
    expect(errorRegistry.get(code)?.owner).toBe('matching');
  });

  it('HTTP status theo hợp đồng', () => {
    expect(PROPOSE_MATCH_ERROR_CODES.map((c) => [c, errorRegistry.statusOf(c)])).toEqual([
      ['MATCH_SAME_USER', 422],
      ['USER_NOT_VERIFIED', 409],
      ['HARD_FILTER_MISMATCH', 409],
    ]);
  });
});
