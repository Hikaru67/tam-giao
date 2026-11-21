import { createDatabase, DrizzleUnitOfWork, OutboxWriter, type Database } from '@tamgiao/db';
import { FakeClock, fail, newId, ok } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CandidateProfile } from '../domain/candidate-profile.js';
import { Match, type MatchStatus } from '../domain/match.js';
import { DrizzleCandidateProfileRepository } from '../infrastructure/drizzle-candidate-profile-repository.js';
import { DrizzleMatchRepository } from '../infrastructure/drizzle-match-repository.js';
import { createMatchingModule, type MatchBoardCursor, type MatchingQueries } from '../index.js';
import { candidate, NOW } from './candidate-fixtures.js';
import { displayProfile, FakeMatchDisplayDirectory } from './match-queries-fakes.js';
import { FakeVerification, RecordingAuditLogger, RecordingScheduler } from './match-fakes.js';

let database: Database;
let uow: DrizzleUnitOfWork;
let queries: MatchingQueries;
const clock = new FakeClock(NOW);
const profiles = new FakeMatchDisplayDirectory();
const candidates = new DrizzleCandidateProfileRepository();
const matchRepo = new DrizzleMatchRepository(new OutboxWriter());
const SCORE = { total: 82, pillars: { VALUES_FAMILY: 90, PLANS_TIMING: 80, LIFESTYLE_FINANCE: 75 } };
const HOUR = 3_600_000;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  uow = new DrizzleUnitOfWork(database.pool);
  queries = createMatchingModule({
    uow,
    clock,
    verification: new FakeVerification(),
    auditLogger: new RecordingAuditLogger(),
    requireAdmin: () => async (_c, next) => next(),
    scheduler: new RecordingScheduler(),
    profiles,
  }).queries;
});
beforeEach(async () => {
  clock.set(NOW);
  profiles.profiles.clear();
  await resetDatabase(database.pool);
});
afterAll(() => database.close());

async function seedCandidate(profile: CandidateProfile): Promise<void> {
  await uow.run(async (tx) => {
    await candidates.upsertProfile(tx, { profile, profileVersion: 1, preferencesVersion: 1 }, NOW);
    await candidates.setVerified(tx, profile.userId, true, NOW);
    return ok();
  });
}

/** Lưu một match qua repository thật; `steps` đổi trạng thái sau khi đề xuất. */
async function seedMatch(
  a: string,
  b: string,
  offeredAt: Date,
  steps: (m: Match) => void = () => undefined,
): Promise<Match> {
  const match = Match.offer(
    {
      id: newId<'Match'>(),
      participants: [a, b],
      createdBy: newId(),
      scoreSnapshot: SCORE,
      staffNote: 'Lời nhắn',
    },
    offeredAt,
  );
  steps(match);
  await uow.run(async (tx) => {
    await matchRepo.save(tx, match);
    return ok();
  });
  return match;
}

const dbExpiresAt = async (matchId: string): Promise<Date | null> =>
  (
    await database.pool.query<{ expires_at: Date | null }>(
      'select expires_at from matching.matches where id = $1',
      [matchId],
    )
  ).rows[0]?.expires_at ?? null;

describe('GetCurrentMatchForUser (Postgres)', () => {
  it('không có match mở (chỉ có match đã đóng) → null', async () => {
    const [a, b] = [newId(), newId()];
    await seedMatch(a, b, NOW, (m) => void m.decline(a, null, NOW));
    const got = await queries.getCurrentMatch.execute({ userId: a });
    expect(got.isOk() && got.value).toBeNull();
  });

  it('AC2 + các trạng thái: OFFERED → AWAITING_RESPONSE (hai phía) → DATING → MET; expiresAt = giá trị DB', async () => {
    const [a, b] = [newId(), newId()];
    await seedCandidate(candidate(a, { gender: 'male' }));
    await seedCandidate(candidate(b));
    profiles.add(displayProfile(a, { fullName: 'Trần Quốc Huy', gender: 'male' }));
    profiles.add(displayProfile(b));

    const offered = await seedMatch(a, b, NOW);
    const fromA = await queries.getCurrentMatch.execute({ userId: a });
    const viewA = fromA.isOk() ? fromA.value : null;
    expect(viewA).toMatchObject({
      matchId: offered.id,
      status: 'OFFERED',
      phase: 'NEEDS_MY_RESPONSE',
      score: SCORE,
      staffNote: 'Lời nhắn',
      counterpart: { userId: b, displayName: 'Minh Trang', age: 28 },
    });
    expect(viewA?.expiresAt).toEqual(await dbExpiresAt(offered.id));
    expect(viewA?.expiresAt?.getTime()).toBe(NOW.getTime() + 24 * HOUR);
    expect(viewA?.commonPoints).toContain('SAME_CITY');

    // A đồng ý sau 2 giờ → AWAITING_RESPONSE với hạn mới.
    const accepted = new Date(NOW.getTime() + 2 * HOUR);
    await uow.run(async (tx) => {
      const m = await matchRepo.findByIdForUpdate(tx, offered.id);
      if (m === null || m.accept(a, accepted).isErr()) throw new Error('setup');
      await matchRepo.save(tx, m);
      return ok();
    });
    const waitA = await queries.getCurrentMatch.execute({ userId: a });
    const waitB = await queries.getCurrentMatch.execute({ userId: b });
    expect(waitA.isOk() && waitA.value?.phase).toBe('WAITING_FOR_COUNTERPART');
    expect(waitB.isOk() && waitB.value?.phase).toBe('COUNTERPART_ACCEPTED');
    expect(waitB.isOk() && waitB.value?.counterpart?.displayName).toBe('Quốc Huy');
    const awaitingExpiry = await dbExpiresAt(offered.id);
    expect(awaitingExpiry?.getTime()).toBe(accepted.getTime() + 24 * HOUR);
    expect(waitB.isOk() && waitB.value?.expiresAt).toEqual(awaitingExpiry);

    // B đồng ý → DATING (hạn 14 ngày), rồi MET (không hạn).
    const dating = new Date(NOW.getTime() + 3 * HOUR);
    await uow.run(async (tx) => {
      const m = await matchRepo.findByIdForUpdate(tx, offered.id);
      if (m === null || m.accept(b, dating).isErr()) throw new Error('setup');
      await matchRepo.save(tx, m);
      return ok();
    });
    const inDating = await queries.getCurrentMatch.execute({ userId: b });
    expect(inDating.isOk() && inDating.value).toMatchObject({
      status: 'DATING',
      phase: 'DATING',
      datingStartedAt: dating,
      expiresAt: await dbExpiresAt(offered.id),
    });
    await uow.run(async (tx) => {
      const m = await matchRepo.findByIdForUpdate(tx, offered.id);
      if (m === null || m.markMet(dating).isErr()) throw new Error('setup');
      await matchRepo.save(tx, m);
      return ok();
    });
    const met = await queries.getCurrentMatch.execute({ userId: a });
    expect(met.isOk() && met.value).toMatchObject({ status: 'MET', phase: 'MET', expiresAt: null });
  });
});

describe('GetMatchProfile (Postgres)', () => {
  it('AC1: người ngoài cặp → NOT_PARTICIPANT; người trong cặp → hồ sơ công khai đối phương', async () => {
    const [a, b, outsider] = [newId(), newId(), newId()];
    profiles.add(displayProfile(a, { fullName: 'Trần Quốc Huy', gender: 'male' }));
    profiles.add(displayProfile(b));
    const match = await seedMatch(a, b, NOW);

    expect(await queries.getMatchProfile.execute({ userId: outsider, matchId: match.id })).toEqual(
      fail('NOT_PARTICIPANT'),
    );
    // Người ngoài không có match mở → không có gì để xem.
    expect(await queries.getMatchProfile.execute({ userId: outsider })).toEqual(fail('NOT_FOUND'));

    const got = await queries.getMatchProfile.execute({ userId: a, matchId: match.id });
    expect(got.isOk() && got.value).toMatchObject({
      matchId: match.id,
      status: 'OFFERED',
      phase: 'NEEDS_MY_RESPONSE',
      score: SCORE,
      counterpart: { userId: b, displayName: 'Minh Trang', bio: 'Tự bạch', photos: displayProfile(b).photos },
    });
    expect(got.isOk() && got.value.expiresAt).toEqual(await dbExpiresAt(match.id));
    expect(got.isOk() && got.value.counterpart).not.toHaveProperty('fullName');
  });

  it('match đã đóng: người trong cặp → NOT_FOUND, người ngoài vẫn NOT_PARTICIPANT', async () => {
    const [a, b] = [newId(), newId()];
    profiles.add(displayProfile(b));
    const match = await seedMatch(a, b, NOW, (m) => void m.decline(b, null, NOW));
    expect(await queries.getMatchProfile.execute({ userId: a, matchId: match.id })).toEqual(
      fail('NOT_FOUND'),
    );
    expect(await queries.getMatchProfile.execute({ userId: newId(), matchId: match.id })).toEqual(
      fail('NOT_PARTICIPANT'),
    );
  });
});

describe('ListCandidates (Postgres)', () => {
  it('top N kèm điểm + hồ sơ hiển thị; người chưa có trong read model → CANDIDATE_PROFILE_NOT_FOUND', async () => {
    const seeker = newId();
    const [c1, c2] = [newId(), newId()];
    await seedCandidate(candidate(seeker, { gender: 'male' }));
    await seedCandidate(candidate(c1));
    await seedCandidate(candidate(c2, { cityKey: 'huế' }));
    profiles.add(displayProfile(c1, { fullName: 'Lê Thu Hà' }));

    const got = await queries.listCandidates.execute({ userId: seeker, limit: 10 });
    const items = got.isOk() ? got.value : [];
    expect(items.map((i) => i.userId)).toEqual([c1, c2]);
    expect(items[0]?.score.total).toBeGreaterThan(items[1]?.score.total ?? 101);
    expect(items[0]?.profile).toMatchObject({ fullName: 'Lê Thu Hà', age: 28 });
    expect(items[0]?.commonPoints).toContain('SAME_CITY');
    expect(items[1]?.profile).toBeNull();

    expect(await queries.listCandidates.execute({ userId: newId() })).toEqual(
      fail('CANDIDATE_PROFILE_NOT_FOUND'),
    );
  });
});

describe('GetMatchesBoard (Postgres)', () => {
  it('mặc định trạng thái mở, sắp hết hạn trước (không hạn cuối), cursor đi hết không trùng/sót', async () => {
    const u = () => newId();
    // Hạn OFFERED = offeredAt + 24h → offeredAt khác nhau cho thứ tự hạn khác nhau.
    const m3 = await seedMatch(u(), u(), new Date(NOW.getTime() + 3 * HOUR));
    const m1 = await seedMatch(u(), u(), new Date(NOW.getTime() + 1 * HOUR));
    const m2a = await seedMatch(u(), u(), new Date(NOW.getTime() + 2 * HOUR));
    const m2b = await seedMatch(u(), u(), new Date(NOW.getTime() + 2 * HOUR));
    const [x, y] = [u(), u()];
    const met = await seedMatch(x, y, NOW, (m) => {
      void m.accept(x, NOW);
      void m.accept(y, NOW);
      void m.markMet(NOW);
    });
    const declined = await seedMatch(u(), u(), NOW, (m) => void m.decline(m.participants[0], null, NOW));
    profiles.add(displayProfile(m1.participants[0], { fullName: 'Lê An' }));

    const sameExpiry = [m2a.id, m2b.id].sort();
    const expected = [m1.id, ...sameExpiry, m3.id, met.id];

    const seen: string[] = [];
    let cursor: MatchBoardCursor | null = null;
    for (let page = 0; page < 10; page += 1) {
      const res = await queries.getMatchesBoard.execute({ cursor, limit: 2 });
      if (res.isErr()) throw new Error('board');
      seen.push(...res.value.items.map((i) => i.matchId));
      cursor = res.value.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(expected);
    expect(seen).not.toContain(declined.id);

    const first = await queries.getMatchesBoard.execute({ cursor: null, limit: 1 });
    const item = first.isOk() ? first.value.items[0] : undefined;
    expect(item).toMatchObject({
      matchId: m1.id,
      status: 'OFFERED',
      score: SCORE,
      participants: [
        { userId: m1.participants[0], fullName: 'Lê An', accepted: false },
        { userId: m1.participants[1], fullName: null, accepted: false },
      ],
    });
    expect(item?.expiresAt).toEqual(await dbExpiresAt(m1.id));
    expect(item).not.toHaveProperty('staffNote');
  });

  it('lọc theo trạng thái', async () => {
    const declined = await seedMatch(
      newId(),
      newId(),
      NOW,
      (m) => void m.decline(m.participants[1], null, NOW),
    );
    await seedMatch(newId(), newId(), NOW);
    const statuses: MatchStatus[] = ['DECLINED'];
    const res = await queries.getMatchesBoard.execute({ statuses, cursor: null });
    expect(res.isOk() && res.value.items.map((i) => [i.matchId, i.status, i.expiresAt])).toEqual([
      [declined.id, 'DECLINED', null],
    ]);
    expect(res.isOk() && res.value.nextCursor).toBeNull();
  });
});
