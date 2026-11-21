import {
  MATCH_PILLAR_NAMES,
  OPEN_MATCH_STATUS_NAMES,
  USER_MATCH_PHASES as CONTRACT_USER_MATCH_PHASES,
} from '@tamgiao/contracts';
import { FakeClock, fail, newId, ok, type Tx } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  MatchBoardCursor,
  MatchBoardQuery,
  MatchBoardRow,
} from '../application/ports/match-board-query.js';
import { GetCurrentMatchForUser } from '../application/queries/get-current-match-for-user.js';
import { GetMatchProfile } from '../application/queries/get-match-profile.js';
import { GetMatchesBoard, MATCHES_BOARD_DEFAULT_STATUSES } from '../application/queries/get-matches-board.js';
import { ListCandidates } from '../application/queries/list-candidates.js';
import {
  displayNameOf,
  phaseFor,
  toCounterpartProfile,
  toScoreView,
  userFacingCommonPoints,
  USER_MATCH_PHASES,
} from '../application/queries/match-display-rules.js';
import { CompatibilityScorer } from '../domain/compatibility-scorer.js';
import { COMPATIBILITY_PILLARS } from '../domain/compatibility-weights.js';
import { Match, OPEN_MATCH_STATUSES, type MatchStatus } from '../domain/match.js';
import { candidate, NOW } from './candidate-fixtures.js';
import { displayProfile, FakeMatchDisplayDirectory } from './match-queries-fakes.js';
import {
  InMemoryCandidateProfileReader,
  InMemoryMatchRepository,
  PassThroughUnitOfWork,
} from './match-fakes.js';

const SCORE = { total: 82, pillars: { VALUES_FAMILY: 90, PLANS_TIMING: 80, LIFESTYLE_FINANCE: 75 } };
const tx = {} as Tx;

describe('luật hiển thị (match-display-rules)', () => {
  it('khớp hằng số contracts (trụ cột, trạng thái mở, giai đoạn)', () => {
    expect([...MATCH_PILLAR_NAMES]).toEqual([...COMPATIBILITY_PILLARS]);
    expect([...OPEN_MATCH_STATUS_NAMES]).toEqual([...OPEN_MATCH_STATUSES]);
    expect([...CONTRACT_USER_MATCH_PHASES]).toEqual([...USER_MATCH_PHASES]);
  });

  it('phaseFor: phân biệt chưa ai đồng ý / đối phương đã đồng ý / mình đã đồng ý; đóng → null', () => {
    expect(phaseFor({ status: 'OFFERED', acceptedBy: [] }, 'a')).toBe('NEEDS_MY_RESPONSE');
    expect(phaseFor({ status: 'AWAITING_RESPONSE', acceptedBy: ['a'] }, 'a')).toBe('WAITING_FOR_COUNTERPART');
    expect(phaseFor({ status: 'AWAITING_RESPONSE', acceptedBy: ['b'] }, 'a')).toBe('COUNTERPART_ACCEPTED');
    expect(phaseFor({ status: 'DATING', acceptedBy: ['a', 'b'] }, 'a')).toBe('DATING');
    expect(phaseFor({ status: 'MET', acceptedBy: ['a', 'b'] }, 'b')).toBe('MET');
    const closed: MatchStatus[] = ['CLOSED_SUCCESS', 'CLOSED_STOPPED', 'EXPIRED', 'DECLINED', 'LOCKED'];
    for (const status of closed) expect(phaseFor({ status, acceptedBy: [] }, 'a')).toBeNull();
  });

  it('displayNameOf: bỏ họ khi ≥ 3 từ, giữ nguyên khi 1–2 từ, gộp khoảng trắng', () => {
    expect(displayNameOf('Nguyễn Minh Trang')).toBe('Minh Trang');
    expect(displayNameOf('  Tôn  Nữ Thị   Hà ')).toBe('Thị Hà');
    expect(displayNameOf('Trần Huy')).toBe('Trần Huy');
    expect(displayNameOf('Lan')).toBe('Lan');
  });

  it('userFacingCommonPoints: bỏ SAME_RELIGION (dữ liệu nhạy cảm), giữ thứ tự mã khác', () => {
    expect(userFacingCommonPoints(['SAME_RELIGION', 'SAME_CITY', 'SHARED_TRAIT_HONEST'])).toEqual([
      'SAME_CITY',
      'SHARED_TRAIT_HONEST',
    ]);
  });

  it('toScoreView: đủ 3 trụ cột; null → null; thiếu trụ cột → throw', () => {
    expect(toScoreView(SCORE)).toEqual(SCORE);
    expect(toScoreView(null)).toBeNull();
    expect(() => toScoreView({ total: 50, pillars: { VALUES_FAMILY: 50 } })).toThrow();
  });

  it('toCounterpartProfile: chỉ phần công khai, tên gọi, tuổi theo ngày VN', () => {
    const view = toCounterpartProfile(displayProfile('u'), NOW);
    expect(view).toEqual({
      userId: 'u',
      displayName: 'Minh Trang',
      age: 28,
      gender: 'female',
      currentCity: 'TP. Hồ Chí Minh',
      occupation: 'Kiểm toán viên',
      education: 'master',
      bio: 'Tự bạch',
      interests: ['chạy bộ'],
      photos: displayProfile('u').photos,
    });
    expect(view).not.toHaveProperty('fullName');
  });
});

describe('query phía người dùng', () => {
  const clock = new FakeClock(NOW);
  let uow: PassThroughUnitOfWork;
  let matches: InMemoryMatchRepository;
  let candidates: InMemoryCandidateProfileReader;
  let profiles: FakeMatchDisplayDirectory;
  const a = newId<'User'>();
  const b = newId<'User'>();
  const outsider = newId<'User'>();

  const deps = () => ({ uow, clock, matches, candidates, profiles });

  async function offered(): Promise<Match> {
    const match = Match.offer(
      {
        id: newId<'Match'>(),
        participants: [a, b],
        createdBy: newId(),
        scoreSnapshot: SCORE,
        staffNote: 'Ghi chú',
      },
      NOW,
    );
    await matches.save(tx, match);
    return match;
  }

  beforeEach(() => {
    uow = new PassThroughUnitOfWork();
    matches = new InMemoryMatchRepository();
    candidates = new InMemoryCandidateProfileReader();
    profiles = new FakeMatchDisplayDirectory();
    candidates.profiles.set(a, candidate(a, { gender: 'male', criteria: { religion: 'buddhism' } }));
    candidates.profiles.set(b, candidate(b, { criteria: { religion: 'buddhism' } }));
    profiles.add(displayProfile(a, { fullName: 'Trần Quốc Huy', gender: 'male', birthDate: '1995-05-01' }));
    profiles.add(displayProfile(b));
  });

  it('GetCurrentMatchForUser: không có match mở → null', async () => {
    const got = await new GetCurrentMatchForUser(deps()).execute({ userId: a });
    expect(got.isOk() && got.value).toBeNull();
  });

  it('GetCurrentMatchForUser: OFFERED → hạn, điểm, điểm chung (không SAME_RELIGION), lời nhắn, đối phương', async () => {
    const match = await offered();
    const got = await new GetCurrentMatchForUser(deps()).execute({ userId: a });
    const expectedCommon = userFacingCommonPoints(
      new CompatibilityScorer().score(candidates.profiles.get(a)!, candidates.profiles.get(b)!, NOW)
        .commonPoints,
    );
    expect(got.isOk() && got.value).toEqual({
      matchId: match.id,
      status: 'OFFERED',
      phase: 'NEEDS_MY_RESPONSE',
      expiresAt: match.expiresAt,
      offeredAt: NOW,
      datingStartedAt: null,
      score: SCORE,
      commonPoints: expectedCommon,
      staffNote: 'Ghi chú',
      counterpart: {
        userId: b,
        displayName: 'Minh Trang',
        age: 28,
        currentCity: 'TP. Hồ Chí Minh',
        occupation: 'Kiểm toán viên',
        education: 'master',
        avatar: displayProfile(b).photos[0],
      },
    });
    expect(expectedCommon).toContain('SAME_CITY');
    expect(expectedCommon).not.toContain('SAME_RELIGION');
    expect(profiles.displayCalls).toEqual([{ userIds: [b], photos: 'primary' }]);
  });

  it('GetCurrentMatchForUser: AWAITING_RESPONSE nhìn từ hai phía; thiếu read model → điểm chung rỗng', async () => {
    const match = await offered();
    const later = new Date(NOW.getTime() + 3_600_000);
    expect(match.accept(a, later).isOk()).toBe(true);
    await matches.save(tx, match);
    candidates.profiles.delete(b);
    const q = new GetCurrentMatchForUser(deps());
    const fromA = await q.execute({ userId: a });
    const fromB = await q.execute({ userId: b });
    expect(fromA.isOk() && fromA.value?.phase).toBe('WAITING_FOR_COUNTERPART');
    expect(fromB.isOk() && fromB.value?.phase).toBe('COUNTERPART_ACCEPTED');
    expect(fromB.isOk() && fromB.value?.expiresAt).toEqual(match.expiresAt);
    expect(fromB.isOk() && fromB.value?.commonPoints).toEqual([]);
    expect(fromB.isOk() && fromB.value?.counterpart?.displayName).toBe('Quốc Huy');
  });

  it('GetCurrentMatchForUser: hồ sơ đối phương không đọc được → counterpart null', async () => {
    await offered();
    profiles.profiles.delete(b);
    const got = await new GetCurrentMatchForUser(deps()).execute({ userId: a });
    expect(got.isOk() && got.value?.counterpart).toBeNull();
  });

  it('GetMatchProfile: người trong cặp → hồ sơ công khai đủ ảnh; theo id hoặc match đang mở', async () => {
    const match = await offered();
    const q = new GetMatchProfile(deps());
    const byId = await q.execute({ userId: b, matchId: match.id });
    const current = await q.execute({ userId: b });
    expect(byId.isOk() && byId.value.counterpart).toEqual(
      toCounterpartProfile(
        displayProfile(a, {
          fullName: 'Trần Quốc Huy',
          gender: 'male',
          birthDate: '1995-05-01',
        }),
        NOW,
      ),
    );
    expect(byId.isOk() && byId.value.counterpart.photos).toHaveLength(2);
    expect(current.isOk() && current.value).toEqual(byId.isOk() && byId.value);
    expect(byId.isOk() && byId.value).not.toHaveProperty('staffNote');
  });

  it('GetMatchProfile: AC1 người ngoài → NOT_PARTICIPANT (cả khi match đã đóng)', async () => {
    const match = await offered();
    const q = new GetMatchProfile(deps());
    expect(await q.execute({ userId: outsider, matchId: match.id })).toEqual(fail('NOT_PARTICIPANT'));
    expect(match.decline(a, null, NOW).isOk()).toBe(true);
    await matches.save(tx, match);
    expect(await q.execute({ userId: outsider, matchId: match.id })).toEqual(fail('NOT_PARTICIPANT'));
  });

  it('GetMatchProfile: id sai → INVALID_ID; không có / đã đóng / hồ sơ mất → NOT_FOUND', async () => {
    const q = new GetMatchProfile(deps());
    expect(await q.execute({ userId: a, matchId: 'abc' })).toEqual(fail('INVALID_ID'));
    expect(await q.execute({ userId: a })).toEqual(fail('NOT_FOUND'));
    expect(await q.execute({ userId: a, matchId: newId() })).toEqual(fail('NOT_FOUND'));
    const match = await offered();
    profiles.profiles.delete(b);
    expect(await q.execute({ userId: a, matchId: match.id })).toEqual(fail('NOT_FOUND'));
    profiles.add(displayProfile(b));
    expect(match.decline(a, null, NOW).isOk()).toBe(true);
    await matches.save(tx, match);
    expect(await q.execute({ userId: a, matchId: match.id })).toEqual(fail('NOT_FOUND'));
  });
});

describe('query admin', () => {
  const clock = new FakeClock(NOW);

  it('ListCandidates: ghép điểm + hồ sơ hiển thị (họ tên đầy đủ, ảnh đại diện); giữ SAME_RELIGION', async () => {
    const seeker = newId<'User'>();
    const c1 = newId<'User'>();
    const c2 = newId<'User'>();
    const profiles = new FakeMatchDisplayDirectory();
    profiles.add(displayProfile(c1));
    const score = {
      total: 70,
      pillars: SCORE.pillars,
      commonPoints: ['SAME_RELIGION', 'SAME_CITY'] as const,
    };
    const calls: unknown[] = [];
    const list = new ListCandidates({
      clock,
      profiles,
      findCandidates: {
        execute: async (cmd) => {
          calls.push(cmd);
          return ok([
            { profile: candidate(c1), score },
            { profile: candidate(c2), score },
          ]);
        },
      },
    });
    const got = await list.execute({ userId: seeker });
    expect(calls).toEqual([{ userId: seeker, limit: 20 }]);
    expect(got.isOk() && got.value).toEqual([
      {
        userId: c1,
        score: { total: 70, pillars: SCORE.pillars },
        commonPoints: ['SAME_RELIGION', 'SAME_CITY'],
        profile: {
          fullName: 'Nguyễn Minh Trang',
          age: 28,
          gender: 'female',
          currentCity: 'TP. Hồ Chí Minh',
          occupation: 'Kiểm toán viên',
          education: 'master',
          avatar: displayProfile(c1).photos[0],
        },
      },
      {
        userId: c2,
        score: { total: 70, pillars: SCORE.pillars },
        commonPoints: ['SAME_RELIGION', 'SAME_CITY'],
        profile: null,
      },
    ]);
    expect(profiles.displayCalls).toEqual([{ userIds: [c1, c2], photos: 'primary' }]);
  });

  it('ListCandidates: id sai → INVALID_ID; lỗi FindCandidates chuyển tiếp', async () => {
    const list = new ListCandidates({
      clock,
      profiles: new FakeMatchDisplayDirectory(),
      findCandidates: { execute: async () => fail('CANDIDATE_PROFILE_NOT_FOUND') },
    });
    expect(await list.execute({ userId: 'x' })).toEqual(fail('INVALID_ID'));
    expect(await list.execute({ userId: newId(), limit: 5 })).toEqual(fail('CANDIDATE_PROFILE_NOT_FOUND'));
  });

  it('GetMatchesBoard: mặc định trạng thái mở, lấy dư 1 dòng → nextCursor, tên qua facade', async () => {
    const [u1, u2, u3, u4] = [newId(), newId(), newId(), newId()];
    const rows: MatchBoardRow[] = [
      boardRow(u1, u2, new Date('2026-11-18T05:00:00Z'), [u1]),
      boardRow(u3, u4, new Date('2026-11-18T06:00:00Z'), []),
      boardRow(u3, u1, null, []),
    ];
    const seen: { statuses: readonly MatchStatus[]; cursor: MatchBoardCursor | null; limit: number }[] = [];
    const board: MatchBoardQuery = {
      list: async (_tx, filter, cursor, limit) => {
        seen.push({ statuses: filter.statuses, cursor, limit });
        return rows.slice(0, limit);
      },
    };
    const profiles = new FakeMatchDisplayDirectory();
    profiles.add(displayProfile(u1, { fullName: 'Lê An' }));
    const q = new GetMatchesBoard({ uow: new PassThroughUnitOfWork(), board, profiles });
    const page = await q.execute({ cursor: null, limit: 2 });
    expect(seen[0]).toEqual({ statuses: MATCHES_BOARD_DEFAULT_STATUSES, cursor: null, limit: 3 });
    expect(page.isOk() && page.value.items.map((i) => i.matchId)).toEqual([rows[0]!.id, rows[1]!.id]);
    expect(page.isOk() && page.value.items[0]!.participants).toEqual([
      { userId: u1, fullName: 'Lê An', accepted: true },
      { userId: u2, fullName: null, accepted: false },
    ]);
    expect(page.isOk() && page.value.nextCursor).toEqual({ expiresAt: rows[1]!.expiresAt, id: rows[1]!.id });

    const last = await q.execute({ statuses: ['EXPIRED', 'EXPIRED'], cursor: null, limit: 5 });
    expect(seen[1]?.statuses).toEqual(['EXPIRED']);
    expect(last.isOk() && last.value.nextCursor).toBeNull();
  });
});

function boardRow(x: string, y: string, expiresAt: Date | null, acceptedBy: string[]): MatchBoardRow {
  return {
    id: newId(),
    participants: [x, y],
    status: expiresAt ? 'OFFERED' : 'MET',
    acceptedBy,
    scoreSnapshot: SCORE,
    expiresAt,
    offeredAt: NOW,
    updatedAt: NOW,
    createdBy: newId(),
  };
}
