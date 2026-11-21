import {
  COOLDOWN_DAYS,
  DATING_DAYS,
  OFFER_TTL_HOURS,
  RESPONSE_TTL_HOURS,
} from '@tamgiao/contracts/constants';
import {
  DEFAULT_RETRY_POLICY,
  DrizzleUnitOfWork,
  PgBossScheduler,
  createDatabase,
  deadLetterQueue,
  jobIdFor,
  registerJob,
  type Database,
  type JobLogger,
} from '@tamgiao/db';
import { FakeClock, addDuration, newId, ok, type DomainError, type Result } from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleCandidateProfileRepository } from '../infrastructure/drizzle-candidate-profile-repository.js';
import {
  MATCH_EXPIRY_QUEUE,
  createExpireMatchJob,
  createMatchingModule,
  type MatchingModule,
} from '../index.js';
import { candidate, NOW } from './candidate-fixtures.js';
import { FakeVerification } from './match-fakes.js';

let database: Database;
let uow: DrizzleUnitOfWork;
let boss: PgBoss;
const verification = new FakeVerification();
const profiles = new DrizzleCandidateProfileRepository();
const auditLogger: AuditLogger = {
  log: async (): Promise<Result<void, DomainError>> => ok(),
};

beforeAll(async () => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  // Gửi job như API (không bảo trì/cron); worker thật chỉ đăng ký trong test pg-boss bên dưới.
  boss = new PgBoss({ connectionString: testDatabaseUrl(), schedule: false });
  boss.on('error', () => undefined);
  await boss.start();
  await boss.createQueue(deadLetterQueue(MATCH_EXPIRY_QUEUE));
  await boss.createQueue(MATCH_EXPIRY_QUEUE, {
    ...DEFAULT_RETRY_POLICY,
    deadLetter: deadLetterQueue(MATCH_EXPIRY_QUEUE),
  });
});

beforeEach(async () => {
  await resetDatabase(database.pool);
  await database.pool.query('delete from pgboss.job where name = $1', [MATCH_EXPIRY_QUEUE]);
});

afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 2_000 });
  await database.close();
});

function matching(clock: FakeClock): MatchingModule {
  return createMatchingModule({
    uow,
    clock,
    verification,
    auditLogger,
    requireAdmin: () => async (_c, next) => next(),
    requireUser: async (_c, next) => next(),
    profiles: { getMatchDisplayProfiles: async () => [], getApplicantSummaries: async () => [] },
    scheduler: new PgBossScheduler(boss),
  });
}

const expirer = (clock: FakeClock) =>
  createExpireMatchJob({ uow, clock, scheduler: new PgBossScheduler(boss) });

async function seedUser(gender: 'male' | 'female'): Promise<string> {
  const id = newId();
  verification.verified.add(id);
  await uow.run(async (tx) => {
    await profiles.upsertProfile(
      tx,
      { profile: candidate(id, { gender }), profileVersion: 1, preferencesVersion: 1 },
      NOW,
    );
    await profiles.setVerified(tx, id, true, NOW);
    return ok();
  });
  return id;
}

/** Đề xuất cặp mới lúc `NOW`. */
async function proposed(): Promise<{ matchId: string; a: string; b: string }> {
  const a = await seedUser('male');
  const b = await seedUser('female');
  const r = await matching(new FakeClock(NOW)).commands.proposeMatch.execute({
    staffId: newId(),
    userAId: a,
    userBId: b,
    staffNote: null,
  });
  if (r.isErr()) throw new Error(r.error.code);
  return { matchId: r.value.matchId, a, b };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const query = async <T extends object>(text: string, params: unknown[] = []): Promise<T[]> =>
  (await database.pool.query<T>(text, params)).rows;

const count = async (text: string, params: unknown[] = []): Promise<number> =>
  Number((await query<{ n: string }>(text, params))[0]?.n);

/** Trạng thái lưu trong DB của một match + mọi thứ phải khớp với nó. */
async function persisted(matchId: string) {
  const [row] = await query<{ status: string; version: number }>(
    'select status, version from matching.matches where id = $1',
    [matchId],
  );
  return {
    status: row?.status,
    version: row?.version,
    events: (
      await query<{ event_type: string }>(
        'select event_type from matching.match_events where match_id = $1 order by version',
        [matchId],
      )
    ).map((e) => e.event_type),
    outbox: await count('select count(*) as n from platform.outbox where aggregate_id = $1', [matchId]),
    slots: await count('select count(*) as n from matching.active_slots where match_id = $1', [matchId]),
    pairHistory: (
      await query<{ outcome: string }>(
        'select last_outcome as outcome from matching.pair_history where last_match_id = $1',
        [matchId],
      )
    ).map((p) => p.outcome),
    jobs: await count(`select count(*) as n from pgboss.job where name = $1 and data->>'matchId' = $2`, [
      MATCH_EXPIRY_QUEUE,
      matchId,
    ]),
  };
}

describe('AcceptOffer / DeclineOffer / ExpireMatch (Postgres + pg-boss)', () => {
  it('AC1: A đồng ý → AWAITING_RESPONSE + job mới; B đồng ý → DATING hạn 14 ngày + job mới, outbox + match_events', async () => {
    const { matchId, a, b } = await proposed();
    const clock = new FakeClock(addDuration(NOW, { hours: 1 }));
    const { commands } = matching(clock);

    const first = await commands.acceptOffer.execute({ userId: a });
    expect(first.isOk() && first.value.status).toBe('AWAITING_RESPONSE');
    clock.advance({ hours: 2 });
    const second = await commands.acceptOffer.execute({ userId: b });
    const datingUntil = addDuration(clock.now(), { days: DATING_DAYS });
    expect(second.isOk() && second.value).toEqual({ matchId, status: 'DATING', expiresAt: datingUntil });

    expect(await persisted(matchId)).toEqual({
      status: 'DATING',
      version: 3,
      events: ['MatchOffered', 'MatchAwaitingResponse', 'MatchStartedDating'],
      outbox: 3,
      slots: 2,
      pairHistory: [],
      jobs: 3,
    });
    const [job] = await query<{ start_after: Date }>('select start_after from pgboss.job where id = $1', [
      jobIdFor(`${MATCH_EXPIRY_QUEUE}:${matchId}:3`),
    ]);
    expect(job?.start_after).toEqual(datingUntil);
    const [awaiting] = await query<{ start_after: Date }>(
      'select start_after from pgboss.job where id = $1',
      [jobIdFor(`${MATCH_EXPIRY_QUEUE}:${matchId}:2`)],
    );
    expect(awaiting?.start_after).toEqual(addDuration(NOW, { hours: 1 + RESPONSE_TTL_HOURS }));
  });

  it('AC3: bỏ qua → slot giải phóng + pair_history; đề xuất lại cặp → PAIR_ALREADY_TRIED; lý do không vào event', async () => {
    const { matchId, a, b } = await proposed();
    const { commands } = matching(new FakeClock(addDuration(NOW, { hours: 1 })));

    const declined = await commands.declineOffer.execute({ userId: b, reason: 'Lý do riêng tư' });
    expect(declined.isOk() && declined.value.status).toBe('DECLINED');
    expect(await persisted(matchId)).toMatchObject({
      status: 'DECLINED',
      slots: 0,
      pairHistory: ['DECLINED'],
      jobs: 1,
    });
    const events = await query('select payload from matching.match_events where match_id = $1', [matchId]);
    expect(JSON.stringify(events)).not.toContain('Lý do');

    const again = await commands.proposeMatch.execute({
      staffId: newId(),
      userAId: a,
      userBId: b,
      staffNote: null,
    });
    expect(again.isErr() && again.error.code).toBe('PAIR_ALREADY_TRIED');
  });

  it('AC2: job hết hạn chạy 2 lần (kể cả đồng thời) → 1 lần chuyển EXPIRED, 1 bộ event', async () => {
    const { matchId } = await proposed();
    const job = expirer(new FakeClock(addDuration(NOW, { hours: OFFER_TTL_HOURS })));

    const settled = await runConcurrently(2, () => job.execute({ matchId }));
    const kinds = settled.map((s) => (s.status === 'fulfilled' ? s.value.kind : 'REJECTED')).sort();
    expect(kinds).toEqual(['ALREADY_CLOSED', 'EXPIRED']);
    expect((await job.execute({ matchId })).kind).toBe('ALREADY_CLOSED');

    expect(await persisted(matchId)).toEqual({
      status: 'EXPIRED',
      version: 2,
      events: ['MatchOffered', 'MatchExpired'],
      outbox: 2,
      slots: 0,
      pairHistory: ['EXPIRED'],
      jobs: 1,
    });
  });

  it('DATING hết 14 ngày → CLOSED_STOPPED + cooldown cả hai tới now + COOLDOWN_DAYS', async () => {
    const { matchId, a, b } = await proposed();
    const { commands } = matching(new FakeClock(NOW));
    await commands.acceptOffer.execute({ userId: a });
    await commands.acceptOffer.execute({ userId: b });
    const end = addDuration(NOW, { days: DATING_DAYS });

    expect(await expirer(new FakeClock(end)).execute({ matchId })).toEqual({
      kind: 'CLOSED_STOPPED',
      fromStatus: 'DATING',
    });
    expect(await persisted(matchId)).toMatchObject({
      status: 'CLOSED_STOPPED',
      slots: 0,
      pairHistory: ['CLOSED_STOPPED'],
    });
    const cooldowns = await query<{ user_id: string; until: Date }>(
      'select user_id, until from matching.cooldowns order by user_id',
    );
    const until = addDuration(end, { days: COOLDOWN_DAYS });
    expect(cooldowns).toEqual([a, b].sort().map((user_id) => ({ user_id, until })));
  });

  it('AC4: A đồng ý ngay trước hạn vs job hết hạn đúng hạn, chạy đồng thời (lặp 30 lần) → một bên thắng, không trạng thái lai', async () => {
    const expiresAt = addDuration(NOW, { hours: OFFER_TTL_HOURS });
    const accept = matching(new FakeClock(new Date(expiresAt.getTime() - 1))).commands.acceptOffer;
    const job = expirer(new FakeClock(expiresAt));
    const winners = { accept: 0, expire: 0 };

    for (let round = 0; round < 30; round++) {
      const { matchId, a } = await proposed();
      // Lệch thời điểm bắt đầu job 0–3 ms để cả hai thứ tự lấy khoá đều xảy ra.
      const [accepted, expired] = await Promise.all([
        accept.execute({ userId: a }),
        sleep(round % 4).then(() => job.execute({ matchId })),
      ]);
      const state = await persisted(matchId);

      if (accepted.isOk()) {
        winners.accept++;
        expect(expired).toEqual({ kind: 'NOT_YET_EXPIRED', status: 'AWAITING_RESPONSE' });
        expect(state).toEqual({
          status: 'AWAITING_RESPONSE',
          version: 2,
          events: ['MatchOffered', 'MatchAwaitingResponse'],
          outbox: 2,
          slots: 2,
          pairHistory: [],
          jobs: 2,
        });
      } else {
        winners.expire++;
        expect(['OFFER_EXPIRED', 'NO_OPEN_MATCH']).toContain(accepted.error.code);
        expect(expired).toEqual({ kind: 'EXPIRED', fromStatus: 'OFFERED' });
        expect(state).toEqual({
          status: 'EXPIRED',
          version: 2,
          events: ['MatchOffered', 'MatchExpired'],
          outbox: 2,
          slots: 0,
          pairHistory: ['EXPIRED'],
          jobs: 1,
        });
      }
    }
    expect(winners.accept + winners.expire).toBe(30);
    // Cả hai thứ tự đều đã được thử (đo thực tế ~25/5).
    expect(winners.accept).toBeGreaterThan(0);
    expect(winners.expire).toBeGreaterThan(0);
  });

  it('AC4: B đồng ý ngay trước hạn chờ phản hồi vs job hết hạn (lặp 20 lần) → DATING hoặc EXPIRED, nhất quán', async () => {
    const t1 = addDuration(NOW, { hours: 1 });
    const responseEnd = addDuration(t1, { hours: RESPONSE_TTL_HOURS });
    const firstAccept = matching(new FakeClock(t1)).commands.acceptOffer;
    const secondAccept = matching(new FakeClock(new Date(responseEnd.getTime() - 1))).commands.acceptOffer;
    const job = expirer(new FakeClock(responseEnd));

    for (let round = 0; round < 20; round++) {
      const { matchId, a, b } = await proposed();
      await firstAccept.execute({ userId: a });
      const [accepted, expired] = await Promise.all([
        secondAccept.execute({ userId: b }),
        sleep(round % 4).then(() => job.execute({ matchId })),
      ]);
      const state = await persisted(matchId);
      if (accepted.isOk()) {
        expect(expired.kind).toBe('NOT_YET_EXPIRED');
        expect(state).toMatchObject({ status: 'DATING', slots: 2, pairHistory: [], jobs: 3 });
        expect(state.events.at(-1)).toBe('MatchStartedDating');
      } else {
        expect(expired.kind).toBe('EXPIRED');
        expect(state).toMatchObject({ status: 'EXPIRED', slots: 0, pairHistory: ['EXPIRED'], jobs: 2 });
        expect(state.events.at(-1)).toBe('MatchExpired');
      }
      expect(state.events).toHaveLength(3);
    }
  });

  it('job pg-boss thật: hết hạn được worker xử lý qua registerJob → EXPIRED, slot trả', async () => {
    const { matchId } = await proposed();
    const silent: JobLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const job = expirer(new FakeClock(addDuration(NOW, { hours: OFFER_TTL_HOURS })));
    await registerJob({
      boss,
      uow,
      logger: silent,
      queue: MATCH_EXPIRY_QUEUE,
      handler: async (payload, tx) => {
        const id = payload['matchId'];
        if (typeof id !== 'string') throw new Error('payload');
        await job.executeIn(tx, { matchId: id });
      },
      pollingIntervalSeconds: 0.5,
    });

    // Job do ProposeMatch hẹn lúc `expiresAt` (đã qua so với giờ thật) → worker nhận ngay.
    const deadline = Date.now() + 20_000;
    while ((await persisted(matchId)).status !== 'EXPIRED') {
      if (Date.now() > deadline) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(await persisted(matchId)).toMatchObject({
      events: ['MatchOffered', 'MatchExpired'],
      slots: 0,
      pairHistory: ['EXPIRED'],
    });
  });
});
