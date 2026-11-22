import { FEEDBACK_SUBMITTED } from '@tamgiao/contracts';
import { COOLDOWN_DAYS } from '@tamgiao/contracts/constants';
import { createDatabase, deliverOnce, DrizzleUnitOfWork, EventBus, type Database } from '@tamgiao/db';
import { addDuration, FakeClock, newId, type DomainEvent } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMatchingWorker, MATCH_CLOSE_ON_FEEDBACK_SUBMITTED_CONSUMER } from '../index.js';
import { NOW } from './candidate-fixtures.js';

let database: Database;
let uow: DrizzleUnitOfWork;
const clock = new FakeClock(NOW);
const bus = new EventBus();
createMatchingWorker({
  clock,
  profiles: { getMatchingProfile: async () => null },
  scheduler: { schedule: async () => undefined },
}).registerConsumers(bus);

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  uow = new DrizzleUnitOfWork(database.pool);
});
beforeEach(async () => {
  await resetDatabase(database.pool);
  clock.set(NOW);
});
afterAll(() => database.close());

const sql = async <T extends object>(text: string, params: unknown[] = []): Promise<T[]> =>
  (await database.pool.query<T>(text, params)).rows;

/** Match ở `status` (DATING | MET) giữa a, b + active slot của cả hai (dựng bằng SQL như user-banned.int.test). */
async function seedMatch(a: string, b: string, status: 'DATING' | 'MET'): Promise<string> {
  const matchId = newId();
  const offeredAt = addDuration(NOW, { days: -3 });
  const met = status === 'MET';
  await database.pool.query(
    `insert into matching.matches
       (id, user_a, user_b, created_by, status, accepted_by, offered_at, expires_at, dating_started_at, met_at,
        updated_at, version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $7, $9, $7, $10)`,
    [
      matchId,
      a,
      b,
      newId(),
      status,
      [a, b],
      offeredAt,
      met ? null : addDuration(NOW, { days: 10 }),
      met ? offeredAt : null,
      met ? 4 : 3,
    ],
  );
  await database.pool.query(
    `insert into matching.active_slots (user_id, match_id, claimed_at) values ($1, $3, $4), ($2, $3, $4)`,
    [a, b, matchId, offeredAt],
  );
  return matchId;
}

const feedbackSubmitted = (matchId: string, a: string, b: string, outcome: string): DomainEvent => ({
  eventId: newId(),
  type: FEEDBACK_SUBMITTED,
  aggregateType: 'DateFeedback',
  aggregateId: newId(),
  version: 1,
  occurredAt: NOW,
  payload: { matchId, datePlanId: newId(), participantIds: [a, b], outcome },
});

const consumer = () => {
  const sub = bus.list().find((s) => s.consumer === MATCH_CLOSE_ON_FEEDBACK_SUBMITTED_CONSUMER);
  if (!sub) throw new Error('consumer chưa đăng ký');
  return sub;
};

const cooldownsOf = (a: string, b: string) =>
  sql<{ user_id: string; until: Date }>(
    'select user_id, until from matching.cooldowns where user_id = any($1) order by user_id',
    [[a, b]],
  );

describe('FeedbackSubmitted → matching CloseMatch (BE-S7-03)', () => {
  it('AC1: SUCCESS → CLOSED_SUCCESS, slot giải phóng, không cooldown, MatchClosed vào outbox', async () => {
    const [a, b] = [newId(), newId()];
    const matchId = await seedMatch(a, b, 'MET');
    clock.advance({ minutes: 5 });

    expect(await deliverOnce(uow, consumer(), feedbackSubmitted(matchId, a, b, 'SUCCESS'))).toBe(true);

    const [match] = await sql<{ status: string; close_outcome: string }>(
      'select status, close_outcome from matching.matches where id = $1',
      [matchId],
    );
    expect(match).toEqual({ status: 'CLOSED_SUCCESS', close_outcome: 'SUCCESS' });
    expect(await sql('select * from matching.active_slots')).toEqual([]);
    expect(await cooldownsOf(a, b)).toEqual([]);
    const closed = await sql<{ payload: unknown }>(
      `select payload from platform.outbox where event_type = 'MatchClosed'`,
    );
    expect(closed.map((r) => r.payload)).toEqual([
      { matchId, participantIds: [a, b], outcome: 'SUCCESS', fromStatus: 'MET', trigger: 'MANUAL' },
    ]);
  });

  it('AC2: STOPPED (match còn DATING) → MatchMet + CLOSED_STOPPED, cả hai cooldown COOLDOWN_DAYS; giao lại → no-op', async () => {
    const [a, b] = [newId(), newId()];
    const matchId = await seedMatch(a, b, 'DATING');
    clock.advance({ minutes: 5 });
    const event = feedbackSubmitted(matchId, a, b, 'STOPPED');

    expect(await deliverOnce(uow, consumer(), event)).toBe(true);

    const [match] = await sql<{ status: string; version: number }>(
      'select status, version from matching.matches where id = $1',
      [matchId],
    );
    expect(match).toEqual({ status: 'CLOSED_STOPPED', version: 5 });
    const until = addDuration(clock.now(), { days: COOLDOWN_DAYS });
    expect((await cooldownsOf(a, b)).map((r) => r.until)).toEqual([until, until]);
    expect(await sql('select * from matching.active_slots')).toEqual([]);
    const types = await sql<{ event_type: string }>(
      `select event_type from platform.outbox where aggregate_id = $1 order by created_at, event_type`,
      [matchId],
    );
    expect(types.map((r) => r.event_type).sort()).toEqual(['MatchClosed', 'MatchMet']);

    // Giao lại cùng event → processed_events chặn; event mới (cùng match) → CloseMatch thấy đã đóng → no-op.
    clock.advance({ days: 1 });
    expect(await deliverOnce(uow, consumer(), event)).toBe(false);
    await deliverOnce(uow, consumer(), feedbackSubmitted(matchId, a, b, 'STOPPED'));
    expect((await cooldownsOf(a, b)).map((r) => r.until)).toEqual([until, until]);
    const [again] = await sql<{ version: number }>('select version from matching.matches where id = $1', [
      matchId,
    ]);
    expect(again?.version).toBe(5);
  });
});
