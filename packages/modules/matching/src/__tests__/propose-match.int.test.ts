import { OFFER_TTL_HOURS } from '@tamgiao/contracts/constants';
import {
  DEFAULT_RETRY_POLICY,
  DrizzleUnitOfWork,
  HmacBlindIndexer,
  LocalKeyEncryptor,
  OutboxWriter,
  PgBossScheduler,
  createDatabase,
  deadLetterQueue,
  jobIdFor,
  type Database,
} from '@tamgiao/db';
import { FakeClock, fail, newId, ok, type DomainError, type Result, type Tx } from '@tamgiao/kernel';
import { ConsoleSmsSender, createIdentityModule } from '@tamgiao/module-identity';
import type { AuditLogger, AuditLogInput } from '@tamgiao/module-identity/facade';
import { resetDatabase, runConcurrently, testDatabaseUrl } from '@tamgiao/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MatchId } from '../domain/match.js';
import { DrizzleActiveSlotRepository } from '../infrastructure/drizzle-active-slot-repository.js';
import { DrizzleCandidateProfileRepository } from '../infrastructure/drizzle-candidate-profile-repository.js';
import { DrizzleMatchRepository } from '../infrastructure/drizzle-match-repository.js';
import { createMatchingModule, MATCH_EXPIRY_QUEUE, type ProposeMatch } from '../index.js';
import { candidate, NOW } from './candidate-fixtures.js';
import { FakeVerification } from './match-fakes.js';

let database: Database;
let uow: DrizzleUnitOfWork;
let boss: PgBoss;
let auditLogger: AuditLogger;
const clock = new FakeClock(NOW);
const verification = new FakeVerification();
const profiles = new DrizzleCandidateProfileRepository();
const staffId = newId();

beforeAll(async () => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  uow = new DrizzleUnitOfWork(database.pool);
  // Giống API: pg-boss chỉ gửi job (không worker, không bảo trì, không cron).
  boss = new PgBoss({ connectionString: testDatabaseUrl(), supervise: false, schedule: false });
  boss.on('error', () => undefined);
  await boss.start();
  await boss.createQueue(deadLetterQueue(MATCH_EXPIRY_QUEUE));
  await boss.createQueue(MATCH_EXPIRY_QUEUE, {
    ...DEFAULT_RETRY_POLICY,
    deadLetter: deadLetterQueue(MATCH_EXPIRY_QUEUE),
  });
  auditLogger = createIdentityModule({
    uow,
    clock,
    encryptor: new LocalKeyEncryptor({ currentVersion: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) }),
    blindIndexer: new HmacBlindIndexer(Buffer.alloc(32, 9)),
    smsSender: new ConsoleSmsSender(),
    authSecret: Buffer.alloc(32, 3),
  }).auditLogger;
});

beforeEach(async () => {
  await resetDatabase(database.pool);
  await database.pool.query('delete from pgboss.job where name = $1', [MATCH_EXPIRY_QUEUE]);
});

afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 2_000 });
  await database.close();
});

function proposeMatch(logger: AuditLogger = auditLogger): ProposeMatch {
  return createMatchingModule({
    uow,
    clock,
    verification,
    auditLogger: logger,
    requireAdmin: () => async (_c, next) => next(),
    requireUser: async (_c, next) => next(),
    scheduler: new PgBossScheduler(boss),
    profiles: { getMatchDisplayProfiles: async () => [], getApplicantSummaries: async () => [] },
  }).commands.proposeMatch;
}

/** Người dùng đã xác thực, có hồ sơ trong read model. */
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

const query = async <T extends object>(text: string, params: unknown[] = []): Promise<T[]> =>
  (await database.pool.query<T>(text, params)).rows;

const count = async (text: string, params: unknown[] = []): Promise<number> =>
  Number((await query<{ n: string }>(text, params))[0]?.n);

async function snapshot(matchFilterUser: string) {
  return {
    matches: await count('select count(*) as n from matching.matches where user_a = $1 or user_b = $1', [
      matchFilterUser,
    ]),
    slots: await count('select count(*) as n from matching.active_slots'),
    outbox: await count(`select count(*) as n from platform.outbox where event_type = 'MatchOffered'`),
    matchEvents: await count('select count(*) as n from matching.match_events'),
    jobs: await count('select count(*) as n from pgboss.job where name = $1', [MATCH_EXPIRY_QUEUE]),
    audits: await count(`select count(*) as n from identity.audit_logs where action = 'match.propose'`),
  };
}

describe('ProposeMatch (Postgres + pg-boss)', () => {
  it('AC2: thành công → 1 match + 2 active slot + outbox MatchOffered + 1 match_events + job hết hạn + audit', async () => {
    const a = await seedUser('male');
    const b = await seedUser('female');

    const result = await proposeMatch().execute({
      staffId,
      userAId: a,
      userBId: b,
      staffNote: 'Ghi chú riêng của chuyên viên',
      ip: '10.0.0.9',
    });
    if (result.isErr()) throw new Error(result.error.code);
    const matchId = result.value.matchId;
    const expiresAt = new Date(NOW.getTime() + OFFER_TTL_HOURS * 3_600_000);

    expect(await snapshot(a)).toEqual({
      matches: 1,
      slots: 2,
      outbox: 1,
      matchEvents: 1,
      jobs: 1,
      audits: 1,
    });

    const [row] = await query<Record<string, unknown>>('select * from matching.matches where id = $1', [
      matchId,
    ]);
    expect(row).toMatchObject({
      user_a: a,
      user_b: b,
      created_by: staffId,
      status: 'OFFERED',
      accepted_by: [],
      staff_note: 'Ghi chú riêng của chuyên viên',
      score_snapshot: result.value.scoreSnapshot,
      expires_at: expiresAt,
      offered_at: NOW,
      version: 1,
    });
    expect(await query('select user_id, match_id from matching.active_slots order by user_id', [])).toEqual(
      [a, b].sort().map((user_id) => ({ user_id, match_id: matchId })),
    );

    const [event] = await query<Record<string, unknown>>(
      'select event_type, payload, version, occurred_at from matching.match_events where match_id = $1',
      [matchId],
    );
    const payload = {
      matchId,
      participantIds: [a, b],
      createdBy: staffId,
      expiresAt: expiresAt.toISOString(),
    };
    expect(event).toEqual({ event_type: 'MatchOffered', payload, version: 1, occurred_at: NOW });
    const [outbox] = await query<Record<string, unknown>>(
      `select aggregate_id, aggregate_version, payload from platform.outbox where event_type = 'MatchOffered'`,
    );
    expect(outbox).toEqual({ aggregate_id: matchId, aggregate_version: 1, payload });
    // Ghi chú chuyên viên (có thể PII) không lọt vào event / audit.
    expect(JSON.stringify([event, outbox])).not.toContain('Ghi chú');

    const [job] = await query<{ id: string; start_after: Date; data: unknown; state: string }>(
      'select id, start_after, data, state from pgboss.job where name = $1',
      [MATCH_EXPIRY_QUEUE],
    );
    expect(job).toEqual({
      id: jobIdFor(`${MATCH_EXPIRY_QUEUE}:${matchId}:1`),
      start_after: expiresAt,
      data: { matchId },
      state: 'created',
    });

    const [audit] = await query<Record<string, unknown>>(
      `select actor_type, actor_id, target_type, target_id, meta from identity.audit_logs
        where action = 'match.propose'`,
    );
    expect(audit).toMatchObject({
      actor_type: 'admin',
      actor_id: staffId,
      target_type: 'match',
      target_id: matchId,
    });
    expect(JSON.stringify(audit)).not.toContain('Ghi chú');
  });

  it('AC2: lỗi ở bước cuối (audit) → rollback toàn bộ: không match, slot, outbox, match_events, job', async () => {
    const a = await seedUser('male');
    const b = await seedUser('female');
    const rejectingLogger: AuditLogger = {
      log: async (..._args: [AuditLogInput] | [Tx, AuditLogInput]): Promise<Result<void, DomainError>> =>
        fail('AUDIT_ENTRY_INVALID'),
    };

    await expect(
      proposeMatch(rejectingLogger).execute({ staffId, userAId: a, userBId: b, staffNote: null }),
    ).rejects.toThrow(/match.propose/);

    expect(await snapshot(a)).toEqual({
      matches: 0,
      slots: 0,
      outbox: 0,
      matchEvents: 0,
      jobs: 0,
      audits: 0,
    });
  });

  it('AC1: một người đang bận → USER_BUSY, không tạo match, không lên lịch job, người kia không bị giữ slot', async () => {
    const a = await seedUser('male');
    const b = await seedUser('female');
    const otherMatch = newId();
    await uow.run(async (tx) => new DrizzleActiveSlotRepository().claim(tx, [b], otherMatch, NOW));

    const result = await proposeMatch().execute({ staffId, userAId: a, userBId: b, staffNote: null });

    expect(result.isErr() && result.error).toEqual({ code: 'USER_BUSY', details: { userIds: [b] } });
    expect(await snapshot(a)).toEqual({
      matches: 0,
      slots: 1,
      outbox: 0,
      matchEvents: 0,
      jobs: 0,
      audits: 0,
    });
    expect(await query('select user_id, match_id from matching.active_slots')).toEqual([
      { user_id: b, match_id: otherMatch },
    ]);
  });

  it('AC3: 2 chuyên viên đề xuất đồng thời cùng A với B và C → đúng 1 thành công (lặp 50 lần)', async () => {
    const useCase = proposeMatch();
    for (let round = 0; round < 50; round++) {
      const a = await seedUser('male');
      const b = await seedUser('female');
      const c = await seedUser('female');
      const jobsBefore = await count('select count(*) as n from pgboss.job where name = $1', [
        MATCH_EXPIRY_QUEUE,
      ]);

      const settled = await runConcurrently(2, (i) =>
        useCase.execute({ staffId: newId(), userAId: a, userBId: i === 0 ? b : c, staffNote: null }),
      );

      const results = settled.map((s) => {
        if (s.status === 'rejected') throw s.reason;
        return s.value;
      });
      const okCount = results.filter((r) => r.isOk()).length;
      const busy = results.filter((r) => r.isErr() && r.error.code === 'USER_BUSY').length;
      expect([okCount, busy]).toEqual([1, 1]);
      expect(
        await count('select count(*) as n from matching.matches where user_a = $1 or user_b = $1', [a]),
      ).toBe(1);
      const jobsAfter = await count('select count(*) as n from pgboss.job where name = $1', [
        MATCH_EXPIRY_QUEUE,
      ]);
      expect(jobsAfter - jobsBefore).toBe(1);
    }
    // Mỗi vòng: đúng 1 match → 2 slot; người thua (B hoặc C) không giữ slot.
    expect(await count('select count(*) as n from matching.active_slots')).toBe(100);
  });
});

describe('DrizzleMatchRepository', () => {
  const repo = new DrizzleMatchRepository(new OutboxWriter());

  async function proposed(): Promise<{ matchId: MatchId; a: string; b: string }> {
    const a = await seedUser('male');
    const b = await seedUser('female');
    const r = await proposeMatch().execute({ staffId, userAId: a, userBId: b, staffNote: 'note' });
    if (r.isErr()) throw new Error(r.error.code);
    return { matchId: r.value.matchId as MatchId, a, b };
  }

  it('findById / findByIdForUpdate / findOpenByUser dựng lại đúng state; lưu chuyển trạng thái tăng version + ghi thêm match_events', async () => {
    const { matchId, a, b } = await proposed();

    const loaded = (await uow.run(async (tx) => ok(await repo.findById(tx, matchId)))).unwrapOr(null);
    expect(loaded?.toState()).toMatchObject({
      id: matchId,
      participants: [a, b],
      createdBy: staffId,
      staffNote: 'note',
      status: 'OFFERED',
      acceptedBy: [],
      version: 1,
    });
    const open = (await uow.run(async (tx) => ok(await repo.findOpenByUser(tx, b)))).unwrapOr(null);
    expect(open?.id).toBe(matchId);

    await uow.run(async (tx) => {
      const match = await repo.findByIdForUpdate(tx, matchId);
      if (match === null) throw new Error('missing');
      expect(match.accept(a, clock.now()).isOk()).toBe(true);
      await repo.save(tx, match);
      return ok();
    });

    const after = (await uow.run(async (tx) => ok(await repo.findById(tx, matchId)))).unwrapOr(null);
    expect(after?.toState()).toMatchObject({ status: 'AWAITING_RESPONSE', acceptedBy: [a], version: 2 });
    expect(
      await query(
        'select event_type, version from matching.match_events where match_id = $1 order by version',
        [matchId],
      ),
    ).toEqual([
      { event_type: 'MatchOffered', version: 1 },
      { event_type: 'MatchAwaitingResponse', version: 2 },
    ]);
  });

  it('lưu bản cũ (version lệch) → throw, không ghi gì', async () => {
    const { matchId, a, b } = await proposed();
    const stale = (await uow.run(async (tx) => ok(await repo.findById(tx, matchId)))).unwrapOr(null);
    if (stale === null) throw new Error('missing');
    await uow.run(async (tx) => {
      const fresh = await repo.findByIdForUpdate(tx, matchId);
      fresh?.accept(a, clock.now());
      if (fresh) await repo.save(tx, fresh);
      return ok();
    });

    stale.accept(b, clock.now());
    await expect(uow.run(async (tx) => ok(await repo.save(tx, stale)))).rejects.toThrow(/xung đột version/);
    expect(
      await count('select count(*) as n from matching.match_events where match_id = $1', [matchId]),
    ).toBe(2);
  });

  it('match_events chỉ ghi thêm: UPDATE / DELETE bị trigger chặn', async () => {
    const { matchId } = await proposed();
    await expect(
      database.pool.query(`update matching.match_events set event_type = 'X' where match_id = $1`, [matchId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      database.pool.query('delete from matching.match_events where match_id = $1', [matchId]),
    ).rejects.toThrow(/append-only/);
  });
});
