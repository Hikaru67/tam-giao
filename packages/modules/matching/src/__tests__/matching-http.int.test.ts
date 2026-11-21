import { createLogger } from '@tamgiao/config';
import {
  adminCandidateListResponseSchema,
  currentMatchResponseSchema,
  MATCH_DECLINE_REASON_MAX_LENGTH,
  MATCH_STAFF_NOTE_MAX_LENGTH,
  matchesBoardResponseSchema,
  matchProfileResponseSchema,
  matchResponseResultSchema,
  problemSchema,
  proposeMatchResponseSchema,
} from '@tamgiao/contracts';
import { OFFER_TTL_HOURS } from '@tamgiao/contracts/constants';
import { createDatabase, DrizzleUnitOfWork, type Database } from '@tamgiao/db';
import {
  createRequireAdmin,
  handleError,
  handleNotFound,
  requestContext,
  requireUser,
  type AppEnv,
} from '@tamgiao/http';
import { FakeClock, fail, newId, ok } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleCandidateProfileRepository } from '../infrastructure/drizzle-candidate-profile-repository.js';
import { createMatchingModule } from '../index.js';
import { candidate, NOW } from './candidate-fixtures.js';
import { FakeVerification, RecordingAuditLogger, RecordingScheduler } from './match-fakes.js';
import { displayProfile, FakeMatchDisplayDirectory } from './match-queries-fakes.js';

let database: Database;
let seedUow: DrizzleUnitOfWork;
let app: Hono<AppEnv>;
const clock = new FakeClock(NOW);
const verification = new FakeVerification();
const directory = new FakeMatchDisplayDirectory();
const auditLogger = new RecordingAuditLogger();
const candidates = new DrizzleCandidateProfileRepository();
const HOUR = 3_600_000;

/** Token giả: người dùng `user.<uuid>`; admin `matchmaker.<id>` có `match:propose`, `reviewer.<id>` chỉ `kyc:review`. */
const staffId = newId<'Admin'>();
const matchmakerToken = `matchmaker.${staffId}`;
const reviewerToken = `reviewer.${newId<'Admin'>()}`;
const userToken = (userId: string) => `user.${userId}`;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  seedUow = new DrizzleUnitOfWork(database.pool);
  const module = createMatchingModule({
    uow: seedUow,
    clock,
    verification,
    auditLogger,
    scheduler: new RecordingScheduler(),
    profiles: directory,
    requireUser: requireUser(async (token) => {
      const [kind, userId] = token.split('.');
      if (kind !== 'user' || userId === undefined) return fail('UNAUTHENTICATED');
      return ok({ userId, sessionId: newId() });
    }),
    requireAdmin: createRequireAdmin(async (token) => {
      const [role, adminId] = token.split('.');
      if (adminId === undefined || (role !== 'matchmaker' && role !== 'reviewer')) {
        return fail('UNAUTHENTICATED');
      }
      const permissions = role === 'matchmaker' ? ['match:propose'] : ['kyc:review'];
      return ok({ adminId, sessionId: newId(), role, permissions });
    }),
  });
  app = new Hono<AppEnv>();
  app.use('*', requestContext(createLogger({ service: 'api', level: 'silent' })));
  app.route('/', module.routes);
  app.notFound(handleNotFound);
  app.onError(handleError);
});

beforeEach(async () => {
  clock.set(NOW);
  directory.profiles.clear();
  auditLogger.entries.length = 0;
  await resetDatabase(database.pool);
});
afterAll(() => database.close());

/** Người dùng đã xác thực, có hồ sơ trong read model `candidate_profiles` + hồ sơ hiển thị (facade giả). */
async function seedUser(gender: 'male' | 'female', fullName = 'Nguyễn Minh Trang'): Promise<string> {
  const id = newId();
  verification.verified.add(id);
  await seedUow.run(async (tx) => {
    await candidates.upsertProfile(
      tx,
      { profile: candidate(id, { gender }), profileVersion: 1, preferencesVersion: 1 },
      NOW,
    );
    await candidates.setVerified(tx, id, true, NOW);
    return ok();
  });
  directory.add(displayProfile(id, { gender, fullName }));
  return id;
}

interface Call {
  readonly token?: string;
  readonly body?: unknown;
  readonly rawBody?: string;
}

async function call(method: 'GET' | 'POST', path: string, opts: Call = {}) {
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers['authorization'] = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  } else if (opts.rawBody !== undefined) {
    headers['content-type'] = 'application/json';
    body = opts.rawBody;
  }
  const res = await app.request(path, { method, headers, ...(body === undefined ? {} : { body }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const propose = (
  userAId: string,
  userBId: string,
  extra: Record<string, unknown> = {},
  token = matchmakerToken,
) => call('POST', '/admin/matches', { token, body: { userAId, userBId, ...extra } });

function expectProblem(res: { status: number; json: Record<string, unknown> }, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(problemSchema.parse(res.json).code).toBe(code);
}

describe('matching HTTP (Postgres thật)', () => {
  it('AC1: propose → A accept → B accept → GET /me/match thấy DATING', async () => {
    const a = await seedUser('male', 'Trần Quốc Huy');
    const b = await seedUser('female');

    const proposed = await propose(a, b, { staffNote: 'Hai bạn cùng thích chạy bộ' });
    expect(proposed.status).toBe(201);
    const offer = proposeMatchResponseSchema.parse(proposed.json);
    expect(offer).toMatchObject({ status: 'OFFERED', participantIds: [a, b] });
    expect(offer.expiresAt).toBe(new Date(NOW.getTime() + OFFER_TTL_HOURS * HOUR).toISOString());
    // staffId lấy từ admin đăng nhập; audit không chứa nội dung ghi chú.
    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({ actor: { type: 'admin', id: staffId }, ip: null });
    expect(JSON.stringify(auditLogger.entries[0])).not.toContain('chạy bộ');

    const offered = currentMatchResponseSchema.parse(
      (await call('GET', '/me/match', { token: userToken(a) })).json,
    );
    expect(offered.match).toMatchObject({
      matchId: offer.matchId,
      status: 'OFFERED',
      phase: 'NEEDS_MY_RESPONSE',
      staffNote: 'Hai bạn cùng thích chạy bộ',
      counterpart: { userId: b, displayName: 'Minh Trang' },
    });

    const profile = await call('GET', `/me/match/profile?matchId=${offer.matchId}`, { token: userToken(a) });
    expect(profile.status).toBe(200);
    expect(matchProfileResponseSchema.parse(profile.json).counterpart.userId).toBe(b);

    clock.advance({ hours: 1 });
    const first = await call('POST', '/me/match/accept', { token: userToken(a) });
    expect(first.status).toBe(200);
    expect(matchResponseResultSchema.parse(first.json)).toMatchObject({
      matchId: offer.matchId,
      status: 'AWAITING_RESPONSE',
    });
    const waiting = currentMatchResponseSchema.parse(
      (await call('GET', '/me/match', { token: userToken(a) })).json,
    );
    expect(waiting.match?.phase).toBe('WAITING_FOR_COUNTERPART');

    const second = await call('POST', '/me/match/accept', { token: userToken(b) });
    expect(second.status).toBe(200);
    const dating = matchResponseResultSchema.parse(second.json);
    expect(dating.status).toBe('DATING');
    expect(dating.expiresAt).not.toBeNull();

    for (const user of [a, b]) {
      const current = currentMatchResponseSchema.parse(
        (await call('GET', '/me/match', { token: userToken(user) })).json,
      );
      expect(current.match).toMatchObject({ matchId: offer.matchId, status: 'DATING', phase: 'DATING' });
      expect(current.match?.datingStartedAt).toBe(new Date(NOW.getTime() + HOUR).toISOString());
    }
  });

  it('GET /me/match không có match mở → { match: null }', async () => {
    const a = await seedUser('male');
    const res = await call('GET', '/me/match', { token: userToken(a) });
    expect(res.status).toBe(200);
    expect(currentMatchResponseSchema.parse(res.json)).toEqual({ match: null });
  });

  it('không token / token sai → 401', async () => {
    expectProblem(await call('GET', '/me/match'), 401, 'UNAUTHENTICATED');
    expectProblem(await call('POST', '/me/match/accept', { token: 'garbage' }), 401, 'UNAUTHENTICATED');
    expectProblem(await call('GET', '/admin/matches'), 401, 'UNAUTHENTICATED');
    expectProblem(await call('POST', '/admin/matches', { body: {} }), 401, 'UNAUTHENTICATED');
    // Token người dùng không dùng được cho route admin.
    expectProblem(await call('GET', '/admin/matches', { token: userToken(newId()) }), 401, 'UNAUTHENTICATED');
  });

  it('admin thiếu permission match:propose → 403 FORBIDDEN', async () => {
    const a = await seedUser('male');
    const b = await seedUser('female');
    expectProblem(await propose(a, b, {}, reviewerToken), 403, 'FORBIDDEN');
    expectProblem(await call('GET', '/admin/matches', { token: reviewerToken }), 403, 'FORBIDDEN');
    expectProblem(
      await call('GET', `/admin/users/${a}/candidates`, { token: reviewerToken }),
      403,
      'FORBIDDEN',
    );
    expect(auditLogger.entries).toHaveLength(0);
  });

  it('đề xuất người đang trong match mở → 409 USER_BUSY', async () => {
    const a = await seedUser('male');
    const b = await seedUser('female');
    const c = await seedUser('female');
    expect((await propose(a, b)).status).toBe(201);
    const busy = await propose(a, c);
    expectProblem(busy, 409, 'USER_BUSY');
    expect(busy.json['meta']).toEqual({ userIds: [a] });
  });

  it('lỗi propose khác map đúng status (MATCH_SAME_USER 422, USER_NOT_VERIFIED 409)', async () => {
    const a = await seedUser('male');
    expectProblem(await propose(a, a), 422, 'MATCH_SAME_USER');
    const unverified = newId();
    expectProblem(await propose(a, unverified), 409, 'USER_NOT_VERIFIED');
  });

  it('phản hồi khi không có match mở → 404 NO_OPEN_MATCH', async () => {
    const a = await seedUser('male');
    for (const action of ['accept', 'decline', 'withdraw']) {
      expectProblem(await call('POST', `/me/match/${action}`, { token: userToken(a) }), 404, 'NO_OPEN_MATCH');
    }
  });

  it('người ngoài cặp xem hồ sơ match → 403 NOT_PARTICIPANT; không có match → 404', async () => {
    const a = await seedUser('male');
    const b = await seedUser('female');
    const outsider = await seedUser('male');
    const offer = proposeMatchResponseSchema.parse((await propose(a, b)).json);

    expectProblem(
      await call('GET', `/me/match/profile?matchId=${offer.matchId}`, { token: userToken(outsider) }),
      403,
      'NOT_PARTICIPANT',
    );
    expectProblem(await call('GET', '/me/match/profile', { token: userToken(outsider) }), 404, 'NOT_FOUND');
  });

  it('withdraw khi chưa đồng ý → 409 INVALID_TRANSITION; accept lại → 409 ALREADY_RESPONDED', async () => {
    const a = await seedUser('male');
    const b = await seedUser('female');
    await propose(a, b);
    expectProblem(
      await call('POST', '/me/match/withdraw', { token: userToken(a) }),
      409,
      'INVALID_TRANSITION',
    );
    expect((await call('POST', '/me/match/accept', { token: userToken(a) })).status).toBe(200);
    expectProblem(await call('POST', '/me/match/accept', { token: userToken(a) }), 409, 'ALREADY_RESPONDED');

    const withdrawn = await call('POST', '/me/match/withdraw', { token: userToken(a) });
    expect(withdrawn.status).toBe(200);
    expect(matchResponseResultSchema.parse(withdrawn.json)).toMatchObject({
      status: 'DECLINED',
      expiresAt: null,
    });
  });

  it('decline: body tuỳ chọn, lý do lưu vào match; quá hạn → 410 OFFER_EXPIRED', async () => {
    const a = await seedUser('male');
    const b = await seedUser('female');
    const offer = proposeMatchResponseSchema.parse((await propose(a, b)).json);
    const declined = await call('POST', '/me/match/decline', {
      token: userToken(b),
      body: { reason: '  Chưa hợp  ' },
    });
    expect(declined.status).toBe(200);
    expect(matchResponseResultSchema.parse(declined.json)).toEqual({
      matchId: offer.matchId,
      status: 'DECLINED',
      expiresAt: null,
    });
    const { rows } = await database.pool.query<{ decline_reason: string | null }>(
      'select decline_reason from matching.matches where id = $1',
      [offer.matchId],
    );
    expect(rows[0]?.decline_reason).toBe('Chưa hợp');

    // Không gửi body → vẫn hợp lệ (không lý do).
    const c = await seedUser('male');
    const d = await seedUser('female');
    await propose(c, d);
    expect((await call('POST', '/me/match/decline', { token: userToken(c) })).status).toBe(200);

    // Quá hạn suy nghĩ → 410.
    const e = await seedUser('male');
    const f = await seedUser('female');
    await propose(e, f);
    clock.advance({ hours: OFFER_TTL_HOURS });
    expectProblem(await call('POST', '/me/match/accept', { token: userToken(e) }), 410, 'OFFER_EXPIRED');
  });

  it('body / query sai → 422 VALIDATION_FAILED, không gọi use case', async () => {
    const a = await seedUser('male');
    const b = await seedUser('female');
    expectProblem(
      await call('POST', '/admin/matches', { token: matchmakerToken, body: { userAId: 'x', userBId: b } }),
      422,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await propose(a, b, { staffNote: 'n'.repeat(MATCH_STAFF_NOTE_MAX_LENGTH + 1) }),
      422,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await call('POST', '/admin/matches', { token: matchmakerToken, rawBody: '{not json' }),
      422,
      'VALIDATION_FAILED',
    );
    expect(auditLogger.entries).toHaveLength(0);

    await propose(a, b);
    expectProblem(
      await call('POST', '/me/match/decline', {
        token: userToken(a),
        body: { reason: 'r'.repeat(MATCH_DECLINE_REASON_MAX_LENGTH + 1) },
      }),
      422,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await call('GET', '/me/match/profile?matchId=not-a-uuid', { token: userToken(a) }),
      422,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await call('GET', `/admin/users/${a}/candidates?limit=0`, { token: matchmakerToken }),
      422,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await call('GET', '/admin/matches?status=BOGUS', { token: matchmakerToken }),
      422,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await call('GET', '/admin/matches?cursor=bm90LWEtY3Vyc29y', { token: matchmakerToken }),
      422,
      'VALIDATION_FAILED',
    );
  });

  it('GET /admin/users/:id/candidates: top N ứng viên kèm hồ sơ; id sai → 400; chưa có hồ sơ → 404', async () => {
    const a = await seedUser('male');
    const b = await seedUser('female', 'Lê Thu Hà');
    const c = await seedUser('female', 'Phạm Lan');
    await seedUser('male');

    const res = await call('GET', `/admin/users/${a}/candidates?limit=5`, { token: matchmakerToken });
    expect(res.status).toBe(200);
    const list = adminCandidateListResponseSchema.parse(res.json);
    expect(list.items.map((i) => i.userId).sort()).toEqual([b, c].sort());
    expect(list.items.find((i) => i.userId === b)?.profile?.fullName).toBe('Lê Thu Hà');

    const one = adminCandidateListResponseSchema.parse(
      (await call('GET', `/admin/users/${a}/candidates?limit=1`, { token: matchmakerToken })).json,
    );
    expect(one.items).toHaveLength(1);

    expectProblem(
      await call('GET', '/admin/users/abc/candidates', { token: matchmakerToken }),
      400,
      'INVALID_ID',
    );
    expectProblem(
      await call('GET', `/admin/users/${newId()}/candidates`, { token: matchmakerToken }),
      404,
      'CANDIDATE_PROFILE_NOT_FOUND',
    );
  });

  it('GET /admin/matches: sắp hết hạn trước, phân trang cursor, lọc trạng thái', async () => {
    const matchIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      clock.set(new Date(NOW.getTime() + i * HOUR));
      const a = await seedUser('male', `Nguyễn Văn ${i}`);
      const b = await seedUser('female');
      matchIds.push(proposeMatchResponseSchema.parse((await propose(a, b)).json).matchId);
    }

    const page1 = await call('GET', '/admin/matches?limit=2', { token: matchmakerToken });
    expect(page1.status).toBe(200);
    const first = matchesBoardResponseSchema.parse(page1.json);
    expect(first.items.map((i) => i.matchId)).toEqual(matchIds.slice(0, 2));
    expect(first.items[0]?.participants[0]?.fullName).toBe('Nguyễn Văn 0');
    expect(first.items[0]?.createdBy).toBe(staffId);
    expect(first.nextCursor).not.toBeNull();
    // Cursor mờ: base64url của `<expiresAt>|<id>`.
    expect(Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8')).toBe(
      `${first.items[1]?.expiresAt}|${matchIds[1]}`,
    );

    const page2 = await call('GET', `/admin/matches?limit=2&cursor=${first.nextCursor}`, {
      token: matchmakerToken,
    });
    const second = matchesBoardResponseSchema.parse(page2.json);
    expect(second.items.map((i) => i.matchId)).toEqual(matchIds.slice(2));
    expect(second.nextCursor).toBeNull();

    // Đóng match đầu (bỏ qua) → mặc định chỉ thấy trạng thái mở; lọc DECLINED thấy nó (không có hạn).
    const firstMatch = first.items[0];
    await call('POST', '/me/match/decline', { token: userToken(firstMatch?.participants[1]?.userId ?? '') });
    const open = matchesBoardResponseSchema.parse(
      (await call('GET', '/admin/matches', { token: matchmakerToken })).json,
    );
    expect(open.items.map((i) => i.matchId)).toEqual(matchIds.slice(1));
    const declined = matchesBoardResponseSchema.parse(
      (await call('GET', '/admin/matches?status=DECLINED,EXPIRED', { token: matchmakerToken })).json,
    );
    expect(declined.items).toHaveLength(1);
    expect(declined.items[0]).toMatchObject({ matchId: matchIds[0], status: 'DECLINED', expiresAt: null });

    // Đóng thêm match thứ hai → lọc DECLINED, trang 1 kết thúc ở dòng không có hạn: cursor `-|<id>` vẫn phân trang tiếp.
    const secondMatch = first.items[1];
    await call('POST', '/me/match/decline', { token: userToken(secondMatch?.participants[1]?.userId ?? '') });
    const closed1 = matchesBoardResponseSchema.parse(
      (await call('GET', '/admin/matches?status=DECLINED&limit=1', { token: matchmakerToken })).json,
    );
    expect(closed1.items.map((i) => i.matchId)).toEqual([matchIds[0]]);
    expect(Buffer.from(closed1.nextCursor ?? '', 'base64url').toString('utf8')).toBe(`-|${matchIds[0]}`);
    const closed2 = matchesBoardResponseSchema.parse(
      (
        await call('GET', `/admin/matches?status=DECLINED&limit=1&cursor=${closed1.nextCursor}`, {
          token: matchmakerToken,
        })
      ).json,
    );
    expect(closed2.items.map((i) => i.matchId)).toEqual([matchIds[1]]);
    expect(closed2.nextCursor).toBeNull();
  });
});
