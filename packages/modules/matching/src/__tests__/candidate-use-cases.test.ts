import { FakeClock, type Result, type Tx, type UnitOfWork } from '@tamgiao/kernel';
import type { MatchingProfile, ProfileFacade } from '@tamgiao/module-profile/facade';
import { beforeEach, describe, expect, it } from 'vitest';
import { SetCandidateVerification, SyncCandidateProfile } from '../application/candidate-profile-sync.js';
import { FindCandidates, MAX_CANDIDATES } from '../application/find-candidates.js';
import type { CandidateFinder, CandidatePool } from '../application/ports/candidate-finder.js';
import type {
  CandidateProfileRepository,
  CandidateProfileSnapshot,
} from '../application/ports/candidate-profile-repository.js';
import { passesHardFilters } from '../domain/candidate-hard-filter.js';
import type { CandidateProfile } from '../domain/candidate-profile.js';
import { bornAged, candidate, NOW } from './candidate-fixtures.js';

function value<T, E>(r: Result<T, E>): T {
  if (r.isErr()) throw new Error(`expected Ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

class PassThroughUnitOfWork implements UnitOfWork {
  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    return work({} as Tx);
  }
}

/** Read model in-memory: cùng luật `passesHardFilters` + tập loại trừ (bận / cooldown / đã thử / chưa xác thực). */
class InMemoryCandidateFinder implements CandidateFinder {
  readonly profiles = new Map<string, CandidateProfile>();
  readonly excluded = new Set<string>();
  lastLimit = 0;

  async find(_tx: Tx, userId: string, limit: number, now: Date): Promise<CandidatePool | null> {
    this.lastLimit = limit;
    const seeker = this.profiles.get(userId);
    if (!seeker) return null;
    const candidates = [...this.profiles.values()]
      .filter((c) => c.userId !== userId && !this.excluded.has(c.userId) && passesHardFilters(seeker, c, now))
      .sort((x, y) => (x.userId < y.userId ? -1 : 1))
      .slice(0, limit);
    return { seeker, candidates };
  }
}

class InMemoryCandidateProfileRepository implements CandidateProfileRepository {
  readonly rows = new Map<string, { snapshot: CandidateProfileSnapshot | null; verified: boolean }>();

  async upsertProfile(_tx: Tx, snapshot: CandidateProfileSnapshot): Promise<void> {
    const row = this.rows.get(snapshot.profile.userId);
    const current = row?.snapshot;
    if (
      current &&
      (current.profileVersion > snapshot.profileVersion ||
        current.preferencesVersion > snapshot.preferencesVersion)
    ) {
      return;
    }
    this.rows.set(snapshot.profile.userId, { snapshot, verified: row?.verified ?? false });
  }

  async setVerified(_tx: Tx, userId: string, verified: boolean): Promise<void> {
    this.rows.set(userId, { snapshot: this.rows.get(userId)?.snapshot ?? null, verified });
  }
}

describe('FindCandidates', () => {
  let finder: InMemoryCandidateFinder;
  let useCase: FindCandidates;

  beforeEach(() => {
    finder = new InMemoryCandidateFinder();
    useCase = new FindCandidates({ uow: new PassThroughUnitOfWork(), clock: new FakeClock(NOW), finder });
    finder.profiles.set('a', candidate('a', { gender: 'male' }));
  });

  it('chấm điểm và sắp giảm dần; hoà điểm → userId tăng dần', async () => {
    finder.profiles.set(
      'c-low',
      candidate('c-low', { cityKey: 'huế', criteria: { coreTraits: ['loyal', 'patient', 'generous'] } }),
    );
    finder.profiles.set('c-best', candidate('c-best'));
    finder.profiles.set('b-best', candidate('b-best'));
    const ranked = value(await useCase.execute({ userId: 'a', limit: 10 }));
    expect(ranked.map((x) => x.profile.userId)).toEqual(['b-best', 'c-best', 'c-low']);
    expect(ranked[0]?.score.total).toBe(94);
    expect(ranked[2]?.score.total).toBeLessThan(94);
  });

  it('top N theo limit (kẹp trong [1, MAX_CANDIDATES])', async () => {
    for (let i = 0; i < 5; i++)
      finder.profiles.set(`c${i}`, candidate(`c${i}`, { birthDate: bornAged(26 + i) }));
    expect(value(await useCase.execute({ userId: 'a', limit: 2 }))).toHaveLength(2);
    expect(value(await useCase.execute({ userId: 'a', limit: 0 }))).toHaveLength(1);
    expect(value(await useCase.execute({ userId: 'a', limit: 10_000 }))).toHaveLength(5);
    expect(MAX_CANDIDATES).toBe(50);
  });

  it('ứng viên vi phạm lọc cứng / bị loại không vào danh sách', async () => {
    finder.profiles.set('ok', candidate('ok'));
    finder.profiles.set('too-old', candidate('too-old', { birthDate: bornAged(40) }));
    finder.profiles.set('busy', candidate('busy'));
    finder.excluded.add('busy');
    const ranked = value(await useCase.execute({ userId: 'a', limit: 10 }));
    expect(ranked.map((x) => x.profile.userId)).toEqual(['ok']);
  });

  it('người tìm chưa có trong read model → CANDIDATE_PROFILE_NOT_FOUND', async () => {
    const r = await useCase.execute({ userId: 'ghost', limit: 10 });
    expect(r.isErr() && r.error.code).toBe('CANDIDATE_PROFILE_NOT_FOUND');
  });
});

const matchingProfile = (userId: string, over: Partial<MatchingProfile> = {}): MatchingProfile => ({
  userId,
  gender: 'female',
  birthDate: '1996-03-02',
  currentCity: '  Hà Nội ',
  education: 'master',
  religion: 'catholicism',
  childrenPlan: 'open',
  criteria: {
    ageMin: 28,
    ageMax: 36,
    areaCity: 'Hà  Nội',
    areaRadiusKm: 20,
    childrenPlan: 'open',
    religion: 'none',
    minEducation: 'bachelor',
    lifestyle: { smoking: 'never', drinking: 'never', dailyRhythm: 'flexible', sports: 'sometimes' },
    financialIndependence: 'required',
    coreTraits: ['loyal', 'kind', 'honest'],
  },
  profileVersion: 2,
  preferencesVersion: 1,
  ...over,
});

describe('SyncCandidateProfile / SetCandidateVerification', () => {
  const tx = {} as Tx;
  const clock = new FakeClock(NOW);
  let repo: InMemoryCandidateProfileRepository;
  let source: Map<string, MatchingProfile>;
  let sync: SyncCandidateProfile;

  beforeEach(() => {
    repo = new InMemoryCandidateProfileRepository();
    source = new Map();
    const profiles: Pick<ProfileFacade, 'getMatchingProfile'> = {
      getMatchingProfile: async (userId) => source.get(userId) ?? null,
    };
    sync = new SyncCandidateProfile({ clock, profiles, candidates: repo });
  });

  it('đọc lại facade, chuẩn hoá thành phố, ghi snapshot kèm version; chạy lại không đổi', async () => {
    source.set('u1', matchingProfile('u1'));
    await sync.handle(tx, { userId: 'u1' });
    await sync.handle(tx, { userId: 'u1' });
    const row = repo.rows.get('u1');
    expect(row?.verified).toBe(false);
    expect(row?.snapshot).toEqual({
      profile: {
        userId: 'u1',
        gender: 'female',
        birthDate: '1996-03-02',
        cityKey: 'hà nội',
        education: 'master',
        religion: 'catholicism',
        childrenPlan: 'open',
        criteria: {
          ageMin: 28,
          ageMax: 36,
          cityKey: 'hà nội',
          childrenPlan: 'open',
          religion: 'none',
          minEducation: 'bachelor',
          lifestyle: { smoking: 'never', drinking: 'never', dailyRhythm: 'flexible', sports: 'sometimes' },
          financialIndependence: 'required',
          coreTraits: ['loyal', 'kind', 'honest'],
        },
      },
      profileVersion: 2,
      preferencesVersion: 1,
    });
  });

  it('hồ sơ cũ chưa khai tôn giáo / con cái (null) → snapshot giữ null (BE-S6-07)', async () => {
    source.set('u4', matchingProfile('u4', { religion: null, childrenPlan: null }));
    await sync.handle(tx, { userId: 'u4' });
    const profile = repo.rows.get('u4')?.snapshot?.profile;
    expect(profile?.religion).toBeNull();
    expect(profile?.childrenPlan).toBeNull();
  });

  it('chưa đủ hồ sơ + tiêu chí (facade trả null) → không ghi gì', async () => {
    await sync.handle(tx, { userId: 'u2' });
    expect(repo.rows.size).toBe(0);
  });

  it('không quan trọng khu vực (areaCity null) → cityKey tiêu chí null', async () => {
    const p = matchingProfile('u3');
    source.set('u3', { ...p, criteria: { ...p.criteria, areaCity: null } });
    await sync.handle(tx, { userId: 'u3' });
    expect(repo.rows.get('u3')?.snapshot?.profile.criteria.cityKey).toBeNull();
  });

  it('KycApproved → verified = true, KycRejected → false; giữ nguyên snapshot', async () => {
    const verify = new SetCandidateVerification({ clock, candidates: repo });
    source.set('u1', matchingProfile('u1'));
    await sync.handle(tx, { userId: 'u1' });
    await verify.handle(tx, { userId: 'u1', verified: true });
    await verify.handle(tx, { userId: 'u1', verified: true });
    expect(repo.rows.get('u1')?.verified).toBe(true);
    expect(repo.rows.get('u1')?.snapshot).not.toBeNull();
    await verify.handle(tx, { userId: 'u1', verified: false });
    expect(repo.rows.get('u1')?.verified).toBe(false);
  });
});
