import { USER_BANNED } from '@tamgiao/contracts';
import { createDatabase, deliverOnce, DrizzleUnitOfWork, EventBus, type Database } from '@tamgiao/db';
import { FakeClock, addDuration, newId, ok, type DomainEvent } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleCandidateFinder } from '../infrastructure/drizzle-candidate-finder.js';
import { DrizzleCandidateProfileRepository } from '../infrastructure/drizzle-candidate-profile-repository.js';
import { MATCH_EXCLUDE_ON_USER_BANNED_CONSUMER, createMatchingWorker } from '../index.js';
import { candidate, NOW } from './candidate-fixtures.js';

let database: Database;
let uow: DrizzleUnitOfWork;
const clock = new FakeClock(NOW);
const repo = new DrizzleCandidateProfileRepository();
const finder = new DrizzleCandidateFinder();
const bus = new EventBus();
const scheduled: unknown[] = [];
createMatchingWorker({
  clock,
  profiles: { getMatchingProfile: async () => null },
  scheduler: { schedule: async (_tx, job) => void scheduled.push(job) },
}).registerConsumers(bus);

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  uow = new DrizzleUnitOfWork(database.pool);
});
beforeEach(async () => {
  await resetDatabase(database.pool);
  scheduled.length = 0;
  clock.set(NOW);
});
afterAll(() => database.close());

const sql = async <T extends object>(text: string, params: unknown[] = []): Promise<T[]> =>
  (await database.pool.query<T>(text, params)).rows;

async function seedCandidate(userId: string, gender: 'male' | 'female'): Promise<void> {
  await uow.run(async (tx) => {
    await repo.upsertProfile(
      tx,
      { profile: candidate(userId, { gender }), profileVersion: 1, preferencesVersion: 1 },
      NOW,
    );
    await repo.setVerified(tx, userId, true, NOW);
    return ok();
  });
}

async function findIds(userId: string): Promise<string[]> {
  const r = await uow.run(async (tx) => ok(await finder.find(tx, userId, 100, clock.now())));
  return r.unwrapOr(null)?.candidates.map((c) => c.userId) ?? [];
}

/** Match `DATING` giữa a, b + active slot của cả hai (dựng bằng SQL như `ProposeMatch` + `AcceptOffer`). */
async function seedDating(a: string, b: string): Promise<string> {
  const matchId = newId();
  const offeredAt = addDuration(NOW, { days: -3 });
  await database.pool.query(
    `insert into matching.matches
       (id, user_a, user_b, created_by, status, accepted_by, offered_at, expires_at, dating_started_at, updated_at, version)
     values ($1, $2, $3, $4, 'DATING', $5, $6, $7, $6, $6, 3)`,
    [matchId, a, b, newId(), [a, b], offeredAt, addDuration(NOW, { days: 10 })],
  );
  await database.pool.query(
    `insert into matching.active_slots (user_id, match_id, claimed_at) values ($1, $3, $4), ($2, $3, $4)`,
    [a, b, matchId, offeredAt],
  );
  return matchId;
}

const userBanned = (userId: string): DomainEvent => ({
  eventId: newId(),
  type: USER_BANNED,
  aggregateType: 'UserBan',
  aggregateId: newId(),
  version: 1,
  occurredAt: NOW,
  payload: { banId: newId(), userId, bannedBy: newId(), reportId: null },
});

const consumer = () => {
  const sub = bus.list().find((s) => s.consumer === MATCH_EXCLUDE_ON_USER_BANNED_CONSUMER);
  if (!sub) throw new Error('consumer chưa đăng ký');
  return sub;
};

describe('UserBanned → matching (BE-S6-06)', () => {
  it('AC1: user bị khoá biến mất khỏi CandidateFinder; match đang mở → LOCKED (USER_BANNED), trả slot, MatchLocked', async () => {
    const seeker = newId();
    const banned = newId();
    const partner = newId();
    const other = newId();
    await seedCandidate(seeker, 'male');
    await seedCandidate(banned, 'female');
    await seedCandidate(other, 'female');
    await seedCandidate(partner, 'male');
    const matchId = await seedDating(banned, partner);
    expect((await findIds(seeker)).sort()).toEqual([other].sort()); // `banned` đang bận match (active slot)

    clock.advance({ minutes: 1 });
    const event = userBanned(banned);
    expect(await deliverOnce(uow, consumer(), event)).toBe(true);

    const [match] = await sql<{ status: string; lock_reason: string }>(
      'select status, lock_reason from matching.matches where id = $1',
      [matchId],
    );
    expect(match).toEqual({ status: 'LOCKED', lock_reason: 'USER_BANNED' });
    expect(await sql('select * from matching.active_slots')).toEqual([]);
    const locked = await sql<{ payload: unknown }>(
      `select payload from platform.outbox where event_type = 'MatchLocked'`,
    );
    expect(locked.map((r) => r.payload)).toEqual([
      { matchId, participantIds: [banned, partner], fromStatus: 'DATING', reason: 'USER_BANNED' },
    ]);
    const [row] = await sql<{ verified: boolean }>(
      'select verified from matching.candidate_profiles where user_id = $1',
      [banned],
    );
    expect(row?.verified).toBe(false);
    // Slot đã trả nhưng user bị khoá vẫn không xuất hiện; người không bị khoá vẫn còn.
    expect(await findIds(seeker)).toEqual([other]);
    expect(await findIds(partner)).toEqual([other]);

    // Giao lại → bỏ qua (processed_events); event khác cùng user → no-op (không còn match mở).
    expect(await deliverOnce(uow, consumer(), event)).toBe(false);
    expect(await deliverOnce(uow, consumer(), userBanned(banned))).toBe(true);
    expect(await sql(`select id from platform.outbox where event_type = 'MatchLocked'`)).toHaveLength(1);
    expect(scheduled).toEqual([]);
  });

  it('user không có match / chưa có dòng read model → chỉ đặt cờ, không lỗi', async () => {
    const lonely = newId();
    expect(await deliverOnce(uow, consumer(), userBanned(lonely))).toBe(true);
    const [row] = await sql<{ verified: boolean }>(
      'select verified from matching.candidate_profiles where user_id = $1',
      [lonely],
    );
    expect(row?.verified).toBe(false);
  });
});
