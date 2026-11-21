import { KYC_APPROVED, KYC_REJECTED, PREFERENCES_UPDATED, PROFILE_COMPLETED } from '@tamgiao/contracts';
import { createDatabase, deliverOnce, DrizzleUnitOfWork, EventBus, type Database } from '@tamgiao/db';
import { FakeClock, newId, ok, type DomainEvent } from '@tamgiao/kernel';
import type { MatchingProfile } from '@tamgiao/module-profile/facade';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { passesHardFilters } from '../domain/candidate-hard-filter.js';
import type { CandidateProfile } from '../domain/candidate-profile.js';
import { DrizzleCandidateFinder } from '../infrastructure/drizzle-candidate-finder.js';
import { DrizzleCandidateProfileRepository } from '../infrastructure/drizzle-candidate-profile-repository.js';
import {
  CANDIDATE_ON_KYC_APPROVED_CONSUMER,
  CANDIDATE_ON_KYC_REJECTED_CONSUMER,
  CANDIDATE_ON_PREFERENCES_UPDATED_CONSUMER,
  CANDIDATE_ON_PROFILE_COMPLETED_CONSUMER,
  createFindCandidates,
  createMatchingWorker,
} from '../index.js';
import { bornAged, candidate, NOW } from './candidate-fixtures.js';

let database: Database;
let uow: DrizzleUnitOfWork;
const clock = new FakeClock(NOW);
const repo = new DrizzleCandidateProfileRepository();
const finder = new DrizzleCandidateFinder();

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  uow = new DrizzleUnitOfWork(database.pool);
});
beforeEach(() => resetDatabase(database.pool));
afterAll(() => database.close());

/** Ghi hồ sơ vào read model (như consumer) + cờ verified. */
async function seed(profile: CandidateProfile, verified = true): Promise<void> {
  await uow.run(async (tx) => {
    await repo.upsertProfile(tx, { profile, profileVersion: 1, preferencesVersion: 1 }, NOW);
    await repo.setVerified(tx, profile.userId, verified, NOW);
    return ok();
  });
}

async function findIds(userId: string, limit = 100): Promise<string[] | null> {
  const r = await uow.run(async (tx) => ok(await finder.find(tx, userId, limit, clock.now())));
  const pool = r.unwrapOr(null);
  return pool === null ? null : pool.candidates.map((c) => c.userId);
}

const sql = (text: string, params: unknown[]) => database.pool.query(text, params);

describe('DrizzleCandidateFinder — lọc cứng hai chiều (AC1)', () => {
  const a = newId();
  beforeEach(() => seed(candidate(a, { gender: 'male' })));

  type Over = Parameters<typeof candidate>[1];
  it.each<[string, Over | undefined, Over]>([
    ['B quá tuổi A muốn (chiều A→B)', undefined, { birthDate: bornAged(36) }],
    ['A ngoài khoảng tuổi B muốn (chiều B→A)', undefined, { criteria: { ageMin: 31, ageMax: 40 } }],
    ['B chỉ muốn Huế, A ở Hà Nội (chiều B→A)', undefined, { criteria: { cityKey: 'huế' } }],
    ['A chỉ muốn Hà Nội, B ở Huế (chiều A→B)', { criteria: { cityKey: 'hà nội' } }, { cityKey: 'huế' }],
    ['tôn giáo xung đột', { criteria: { religion: 'buddhism' } }, { criteria: { religion: 'catholicism' } }],
    ['kế hoạch con cái xung đột', undefined, { criteria: { childrenPlan: 'no_children' } }],
    ['cùng giới (chỉ ghép khác giới)', undefined, { gender: 'male' }],
  ])('%s → bị loại', async (_name, seekerOver, badOver) => {
    if (seekerOver) await seed(candidate(a, { gender: 'male', ...seekerOver }));
    const good = newId();
    const bad = newId();
    await seed(candidate(good));
    await seed(candidate(bad, badOver));
    expect(await findIds(a)).toEqual([good]);
    // Chiều ngược lại: B tìm cũng không thấy A.
    expect(await findIds(bad)).not.toContain(a);
  });

  it('SQL khớp đúng `passesHardFilters` trên lưới hồ sơ mẫu (mọi cặp)', async () => {
    const profiles: CandidateProfile[] = [];
    const ages = [24, 29, 33, 38];
    const cities = ['hà nội', 'huế'];
    const religions = ['buddhism', 'catholicism', 'not_important'] as const;
    const plans = ['want_children', 'no_children', 'open'] as const;
    let k = 0;
    for (const age of ages)
      for (const city of cities) {
        const i = k++;
        profiles.push(
          candidate(newId(), {
            gender: i % 2 === 0 ? 'female' : 'male',
            birthDate: bornAged(age),
            cityKey: city,
            criteria: {
              ageMin: 22 + (i % 3) * 4,
              ageMax: 30 + (i % 4) * 3,
              cityKey: i % 3 === 0 ? city : i % 3 === 1 ? null : 'hà nội',
              religion: religions[i % religions.length] ?? 'not_important',
              childrenPlan: plans[i % plans.length] ?? 'open',
            },
          }),
        );
      }
    for (const p of profiles) await seed(p);
    const all = [candidate(a, { gender: 'male' }), ...profiles]; // A đã seed ở beforeEach
    for (const seeker of all) {
      const expected = all
        .filter((c) => c.userId !== seeker.userId && passesHardFilters(seeker, c, NOW))
        .map((c) => c.userId)
        .sort();
      expect(await findIds(seeker.userId)).toEqual(expected);
    }
  });

  it('trả dữ liệu đủ để chấm điểm (Value Object khôi phục đúng)', async () => {
    const b = candidate(newId(), { criteria: { minEducation: 'college', cityKey: 'hà nội' } });
    await seed(b);
    const r = await uow.run(async (tx) => ok(await finder.find(tx, a, 10, NOW)));
    const pool = r.unwrapOr(null);
    expect(pool?.seeker).toEqual(candidate(a, { gender: 'male' }));
    expect(pool?.candidates).toEqual([b]);
  });

  it('limit giới hạn số dòng, thứ tự ổn định theo userId', async () => {
    const ids = [newId(), newId(), newId()];
    for (const id of ids) await seed(candidate(id));
    expect(await findIds(a, 2)).toEqual([...ids].sort().slice(0, 2));
  });
});

describe('DrizzleCandidateFinder — loại bận / cooldown / đã thử / chưa xác thực (AC3)', () => {
  const a = newId();
  beforeEach(() => seed(candidate(a, { gender: 'male' })));

  it('chỉ còn ứng viên rảnh, đã xác thực, chưa thử cặp', async () => {
    const uid = (): string => newId();
    const [free, busy, cooling, cooled, tried] = [uid(), uid(), uid(), uid(), uid()];
    const [unverified, rejected, noProfile] = [uid(), uid(), uid()];
    for (const id of [free, busy, cooling, cooled, tried, rejected]) await seed(candidate(id));
    await seed(candidate(unverified), false);
    // KycRejected sau khi đã duyệt → verified = false.
    await uow.run(async (tx) => {
      await repo.setVerified(tx, rejected, false, NOW);
      // Đã xác thực nhưng chưa đồng bộ hồ sơ (chỉ có cờ verified).
      await repo.setVerified(tx, noProfile, true, NOW);
      return ok();
    });

    await sql(`insert into matching.active_slots (user_id, match_id, claimed_at) values ($1, $2, $3)`, [
      busy,
      newId(),
      NOW,
    ]);
    await sql(
      `insert into matching.cooldowns (user_id, until, updated_at) values ($1, $2, $3), ($4, $5, $3)`,
      [cooling, new Date(NOW.getTime() + 3_600_000), NOW, cooled, new Date(NOW.getTime() - 1)],
    );
    const [low, high] = a < tried ? [a, tried] : [tried, a];
    await sql(
      `insert into matching.pair_history (user_low, user_high, last_outcome, last_match_id, updated_at)
       values ($1, $2, 'DECLINED', $3, $4)`,
      [low, high, newId(), NOW],
    );

    expect(await findIds(a)).toEqual([free, cooled].sort());
  });

  it('người tìm chưa có / chưa đồng bộ hồ sơ → null; không tự trả chính mình', async () => {
    expect(await findIds(newId())).toBeNull();
    const onlyFlag = newId();
    await uow.run(async (tx) => {
      await repo.setVerified(tx, onlyFlag, true, NOW);
      return ok();
    });
    expect(await findIds(onlyFlag)).toBeNull();
    expect(await findIds(a)).toEqual([]);
  });

  it('createFindCandidates: top N theo điểm, ứng viên bận không xuất hiện', async () => {
    const best = newId();
    const weaker = newId();
    const busy = newId();
    await seed(candidate(best));
    await seed(
      candidate(weaker, { cityKey: 'huế', criteria: { coreTraits: ['loyal', 'patient', 'generous'] } }),
    );
    await seed(candidate(busy));
    await sql(`insert into matching.active_slots (user_id, match_id, claimed_at) values ($1, $2, $3)`, [
      busy,
      newId(),
      NOW,
    ]);
    const r = await createFindCandidates({ uow, clock }).execute({ userId: a, limit: 10 });
    const ranked = r.unwrapOr([]);
    expect(ranked.map((x) => x.profile.userId)).toEqual([best, weaker]);
    expect(ranked[0]?.score.total).toBe(94);
  });
});

describe('consumer read model matching.candidate_profiles', () => {
  const bus = new EventBus();
  const source = new Map<string, MatchingProfile>();
  createMatchingWorker({
    clock,
    profiles: { getMatchingProfile: async (userId) => source.get(userId) ?? null },
  }).registerConsumers(bus);

  const sub = (consumer: string) => {
    const s = bus.list().find((x) => x.consumer === consumer);
    if (!s) throw new Error(`missing consumer ${consumer}`);
    return s;
  };
  const event = (type: string, userId: string): DomainEvent => ({
    eventId: newId(),
    type,
    aggregateType: 'Test',
    aggregateId: userId,
    version: 1,
    occurredAt: NOW,
    payload: { userId, submissionId: newId() },
  });
  const matchingProfile = (userId: string, versions: [number, number], ageMax = 36): MatchingProfile => ({
    userId,
    gender: 'female',
    birthDate: '1996-03-02',
    currentCity: 'Hà Nội',
    education: 'master',
    criteria: {
      ageMin: 28,
      ageMax,
      areaCity: null,
      areaRadiusKm: null,
      childrenPlan: 'open',
      religion: 'none',
      minEducation: null,
      lifestyle: { smoking: 'never', drinking: 'never', dailyRhythm: 'flexible', sports: 'sometimes' },
      financialIndependence: 'required',
      coreTraits: ['loyal', 'kind', 'honest'],
    },
    profileVersion: versions[0],
    preferencesVersion: versions[1],
  });
  const row = async (userId: string) =>
    (
      await sql(
        `select verified, gender, birth_date::text as birth_date, city_key, pref_age_max, pref_city_key,
                profile_version, preferences_version, scoring
           from matching.candidate_profiles where user_id = $1`,
        [userId],
      )
    ).rows[0];

  it('đăng ký đúng tên consumer cho 4 event', () => {
    expect(bus.list().map((s) => [s.eventType, s.consumer])).toEqual([
      [PROFILE_COMPLETED, CANDIDATE_ON_PROFILE_COMPLETED_CONSUMER],
      [PREFERENCES_UPDATED, CANDIDATE_ON_PREFERENCES_UPDATED_CONSUMER],
      [KYC_APPROVED, CANDIDATE_ON_KYC_APPROVED_CONSUMER],
      [KYC_REJECTED, CANDIDATE_ON_KYC_REJECTED_CONSUMER],
    ]);
  });

  it('KycApproved trước, hồ sơ sau → dòng đủ + verified; giao lại event không đổi kết quả (A9)', async () => {
    const u = newId();
    const approved = event(KYC_APPROVED, u);
    expect(await deliverOnce(uow, sub(CANDIDATE_ON_KYC_APPROVED_CONSUMER), approved)).toBe(true);
    expect(await row(u)).toMatchObject({ verified: true, gender: null, profile_version: null });

    source.set(u, matchingProfile(u, [2, 1]));
    const completed = event(PROFILE_COMPLETED, u);
    expect(await deliverOnce(uow, sub(CANDIDATE_ON_PROFILE_COMPLETED_CONSUMER), completed)).toBe(true);
    expect(await deliverOnce(uow, sub(CANDIDATE_ON_PROFILE_COMPLETED_CONSUMER), completed)).toBe(false);
    // Event khác cùng nội dung (vd phát lại) → handler tự idempotent.
    expect(
      await deliverOnce(uow, sub(CANDIDATE_ON_PROFILE_COMPLETED_CONSUMER), event(PROFILE_COMPLETED, u)),
    ).toBe(true);
    expect(await row(u)).toEqual({
      verified: true,
      gender: 'female',
      birth_date: '1996-03-02',
      city_key: 'hà nội',
      pref_age_max: 36,
      pref_city_key: null,
      profile_version: 2,
      preferences_version: 1,
      scoring: {
        lifestyle: { smoking: 'never', drinking: 'never', dailyRhythm: 'flexible', sports: 'sometimes' },
        financialIndependence: 'required',
        coreTraits: ['loyal', 'kind', 'honest'],
      },
    });
  });

  it('PreferencesUpdated cập nhật tiêu chí; bản cũ hơn (version thấp) không ghi đè bản mới', async () => {
    const u = newId();
    source.set(u, matchingProfile(u, [2, 3], 40));
    await deliverOnce(uow, sub(CANDIDATE_ON_PREFERENCES_UPDATED_CONSUMER), event(PREFERENCES_UPDATED, u));
    expect(await row(u)).toMatchObject({ pref_age_max: 40, preferences_version: 3, verified: false });

    source.set(u, matchingProfile(u, [2, 2], 33)); // bản đọc từ trước (consumer chạy chậm)
    await deliverOnce(uow, sub(CANDIDATE_ON_PROFILE_COMPLETED_CONSUMER), event(PROFILE_COMPLETED, u));
    expect(await row(u)).toMatchObject({ pref_age_max: 40, preferences_version: 3 });
  });

  it('hồ sơ chưa hoàn tất / chưa có tiêu chí (facade null) → không tạo dòng', async () => {
    const u = newId();
    await deliverOnce(uow, sub(CANDIDATE_ON_PROFILE_COMPLETED_CONSUMER), event(PROFILE_COMPLETED, u));
    expect(await row(u)).toBeUndefined();
  });

  it('KycRejected → verified = false', async () => {
    const u = newId();
    await deliverOnce(uow, sub(CANDIDATE_ON_KYC_APPROVED_CONSUMER), event(KYC_APPROVED, u));
    await deliverOnce(uow, sub(CANDIDATE_ON_KYC_REJECTED_CONSUMER), event(KYC_REJECTED, u));
    expect(await row(u)).toMatchObject({ verified: false });
  });
});
