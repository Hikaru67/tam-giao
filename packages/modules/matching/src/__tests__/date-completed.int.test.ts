import { DATING_DAYS } from '@tamgiao/contracts/constants';
import { createDatabase, deliverOnce, DrizzleUnitOfWork, EventBus, type Database } from '@tamgiao/db';
import { FakeClock, addDuration, newId, type DomainEvent } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DATE_COMPLETED_EVENT,
  MATCH_MET_ON_DATE_COMPLETED_CONSUMER,
  createExpireMatchJob,
  createMatchingWorker,
} from '../index.js';
import { NOW } from './candidate-fixtures.js';

let database: Database;
let uow: DrizzleUnitOfWork;
const clock = new FakeClock(NOW);
const bus = new EventBus();
const scheduled: unknown[] = [];
const scheduler = { schedule: async (_tx: unknown, job: unknown) => void scheduled.push(job) };
createMatchingWorker({ clock, profiles: { getMatchingProfile: async () => null }, scheduler }).registerConsumers(
  bus,
);

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

/** Match `DATING` bắt đầu lúc `NOW` (hạn `NOW + DATING_DAYS`) + active slot của cả hai (như `AcceptOffer`). */
async function seedDating(a: string, b: string): Promise<string> {
  const matchId = newId();
  await sql(
    `insert into matching.matches
       (id, user_a, user_b, created_by, status, accepted_by, offered_at, expires_at, dating_started_at, updated_at, version)
     values ($1, $2, $3, $4, 'DATING', $5, $6, $7, $6, $6, 3)`,
    [matchId, a, b, newId(), [a, b], NOW, addDuration(NOW, { days: DATING_DAYS })],
  );
  await sql(
    `insert into matching.active_slots (user_id, match_id, claimed_at) values ($1, $3, $4), ($2, $3, $4)`,
    [a, b, matchId, NOW],
  );
  return matchId;
}

const dateCompleted = (matchId: string, a: string, b: string): DomainEvent => ({
  eventId: newId(),
  type: DATE_COMPLETED_EVENT,
  aggregateType: 'DatePlan',
  aggregateId: newId(),
  version: 4,
  occurredAt: clock.now(),
  payload: { datePlanId: newId(), matchId, inviterId: a, inviteeId: b },
});

const consumer = () => {
  const sub = bus.list().find((s) => s.consumer === MATCH_MET_ON_DATE_COMPLETED_CONSUMER);
  if (!sub) throw new Error('consumer chưa đăng ký');
  return sub;
};

describe('DateCompleted → matching MET (BE-S7-04)', () => {
  it('DATING → MET (bỏ hạn), MatchMet vào outbox, giữ slot; giao lại → bỏ qua; job hết hạn cũ → no-op', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);
    const metAt = clock.advance({ days: 6 });
    const event = dateCompleted(matchId, a, b);

    expect(await deliverOnce(uow, consumer(), event)).toBe(true);
    const [row] = await sql<{ status: string; met_at: Date; expires_at: Date | null; version: number }>(
      'select status, met_at, expires_at, version from matching.matches where id = $1',
      [matchId],
    );
    expect(row).toEqual({ status: 'MET', met_at: metAt, expires_at: null, version: 4 });
    const met = await sql<{ payload: unknown }>(
      `select payload from platform.outbox where event_type = 'MatchMet' and aggregate_id = $1`,
      [matchId],
    );
    expect(met.map((r) => r.payload)).toEqual([{ matchId, participantIds: [a, b] }]);
    expect(await sql('select user_id from matching.active_slots')).toHaveLength(2);
    expect(scheduled).toEqual([]);

    // Giao lại (processed_events) / event DateCompleted khác cho cùng match → no-op.
    expect(await deliverOnce(uow, consumer(), event)).toBe(false);
    expect(await deliverOnce(uow, consumer(), dateCompleted(matchId, a, b))).toBe(true);
    expect(await sql(`select id from platform.outbox where event_type = 'MatchMet'`)).toHaveLength(1);

    // Job hết hạn DATING (hẹn lúc vào DATING) chạy đúng hạn → MET không có hạn → no-op, không đóng match.
    clock.set(addDuration(NOW, { days: DATING_DAYS }));
    const expirer = createExpireMatchJob({ uow, clock, scheduler });
    expect(await expirer.execute({ matchId })).toEqual({ kind: 'ALREADY_CLOSED', status: 'MET' });
  });

  it('match đã đóng vì hết DATING_DAYS → DateCompleted tới sau không mở lại (no-op)', async () => {
    const a = newId();
    const b = newId();
    const matchId = await seedDating(a, b);
    clock.set(addDuration(NOW, { days: DATING_DAYS }));
    await createExpireMatchJob({ uow, clock, scheduler }).execute({ matchId });

    expect(await deliverOnce(uow, consumer(), dateCompleted(matchId, a, b))).toBe(true);
    const [row] = await sql<{ status: string; close_reason: string }>(
      'select status, close_reason from matching.matches where id = $1',
      [matchId],
    );
    expect(row).toEqual({ status: 'CLOSED_STOPPED', close_reason: 'TIMEOUT' });
    expect(await sql(`select id from platform.outbox where event_type = 'MatchMet'`)).toEqual([]);
  });

  it('payload thiếu matchId → throw (lỗi lập trình của bên phát)', async () => {
    const event = { ...dateCompleted(newId(), newId(), newId()), payload: { datePlanId: newId() } };
    await expect(deliverOnce(uow, consumer(), event)).rejects.toThrow(/matchId/);
  });
});
