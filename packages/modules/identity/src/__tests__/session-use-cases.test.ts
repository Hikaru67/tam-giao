import { FakeClock, newId, ok } from '@tamgiao/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthenticateUser } from '../application/queries/authenticate-user.js';
import { SessionIssuer } from '../application/session-issuer.js';
import { ListSessions, RevokeSession } from '../application/use-cases/manage-sessions.js';
import { RefreshSession } from '../application/use-cases/refresh-session.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
  Session,
  newRefreshTokenRecord,
  type RefreshTokenId,
  type SessionId,
} from '../domain/session.js';
import type { UserId } from '../domain/user.js';
import {
  FakeAccessTokenService,
  FakeRefreshTokenSecrets,
  FakeUnitOfWork,
  InMemorySessionRepository,
} from './fakes.js';

const USER = newId<'User'>() as UserId;

function setup() {
  const clock = new FakeClock(new Date('2026-11-16T08:00:00.000Z'));
  const sessions = new InMemorySessionRepository();
  const accessTokens = new FakeAccessTokenService();
  const refreshSecrets = new FakeRefreshTokenSecrets();
  const issuer = new SessionIssuer(sessions, accessTokens, refreshSecrets);
  const uow = new FakeUnitOfWork([sessions.table, sessions.tokens]);
  const login = async (deviceName: string | null = 'iPhone 15', userId: UserId = USER) => {
    const r = await uow.run(async (tx) => ok(await issuer.startSession(tx, userId, deviceName, clock.now())));
    if (r.isErr()) throw new Error('unreachable');
    return r.value;
  };
  return {
    clock,
    sessions,
    login,
    refresh: new RefreshSession({ uow, clock, sessions, refreshSecrets, issuer }),
    authenticate: new AuthenticateUser({ uow, clock, sessions, accessTokens }),
    list: new ListSessions({ uow, clock, sessions }),
    revoke: new RevokeSession({ uow, clock, sessions }),
  };
}

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

const codeOf = (r: { isErr(): boolean; error?: { code: string } }) => (r.isErr() ? r.error?.code : undefined);

describe('Session (domain)', () => {
  const now = new Date('2026-11-16T08:00:00.000Z');
  const make = () => Session.start({ id: newId<'Session'>(), userId: USER, deviceName: null }, now);
  const tokenOf = (s: Session, over: { usedAt?: Date | null } = {}) => ({
    ...newRefreshTokenRecord(
      { id: newId<'RefreshToken'>() as RefreshTokenId, sessionId: s.id, tokenHash: 'h' },
      now,
    ),
    ...over,
  });

  it('token chưa dùng, còn hạn → ok và cập nhật lastUsedAt', () => {
    const s = make();
    const later = new Date(now.getTime() + 60_000);
    expect(s.rotate(tokenOf(s), later).isOk()).toBe(true);
    expect(s.toState().lastUsedAt).toEqual(later);
  });

  it('token đã dùng → TOKEN_REUSED và phiên bị thu hồi', () => {
    const s = make();
    expect(codeOf(s.rotate(tokenOf(s, { usedAt: now }), now))).toBe('TOKEN_REUSED');
    expect(s.isActive).toBe(false);
    expect(s.toState().revokeReason).toBe('REFRESH_TOKEN_REUSED');
  });

  it('token quá hạn → TOKEN_EXPIRED, phiên vẫn hoạt động', () => {
    const s = make();
    const expired = new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    expect(codeOf(s.rotate(tokenOf(s), expired))).toBe('TOKEN_EXPIRED');
    expect(s.isActive).toBe(true);
  });

  it('phiên đã thu hồi → UNAUTHENTICATED', () => {
    const s = make();
    s.revoke('LOGOUT', now);
    expect(codeOf(s.rotate(tokenOf(s), now))).toBe('UNAUTHENTICATED');
  });

  it('revoke idempotent: giữ lý do và thời điểm đầu tiên', () => {
    const s = make();
    s.revoke('LOGOUT', now);
    s.revoke('REVOKED_BY_USER', new Date(now.getTime() + 1_000));
    expect(s.toState()).toMatchObject({ revokedAt: now, revokeReason: 'LOGOUT' });
  });

  it('token của phiên khác → lỗi lập trình (throw)', () => {
    const a = make();
    const b = make();
    expect(() => a.rotate(tokenOf(b), now)).toThrow();
  });
});

describe('RefreshSession', () => {
  it('xoay vòng: trả cặp token mới, token mới dùng được, cùng sessionId', async () => {
    const first = await t.login();
    t.clock.advance({ minutes: 10 });
    const second = await t.refresh.execute({ refreshToken: first.refreshToken });
    expect(second.isOk()).toBe(true);
    if (!second.isOk()) return;
    expect(second.value.sessionId).toBe(first.sessionId);
    expect(second.value.refreshToken).not.toBe(first.refreshToken);
    expect(second.value.accessTokenExpiresInSeconds).toBe(ACCESS_TOKEN_TTL_SECONDS);

    const third = await t.refresh.execute({ refreshToken: second.value.refreshToken });
    expect(third.isOk()).toBe(true);
  });

  it('dùng lại refresh token cũ sau khi đã xoay → TOKEN_REUSED, thu hồi cả phiên (AC1)', async () => {
    const first = await t.login();
    const second = await t.refresh.execute({ refreshToken: first.refreshToken });
    if (!second.isOk()) throw new Error('refresh lần đầu phải thành công');

    const reused = await t.refresh.execute({ refreshToken: first.refreshToken });
    expect(codeOf(reused)).toBe('TOKEN_REUSED');

    // Việc thu hồi đã được commit (không bị rollback cùng lỗi).
    const state = t.sessions.table.rows.get(first.sessionId as SessionId);
    expect(state?.revokeReason).toBe('REFRESH_TOKEN_REUSED');
    // Token mới nhất của họ cũng hết hiệu lực…
    expect(codeOf(await t.refresh.execute({ refreshToken: second.value.refreshToken }))).toBe(
      'UNAUTHENTICATED',
    );
    // …và access token đang có bị chặn ngay.
    expect(codeOf(await t.authenticate.execute(second.value.accessToken))).toBe('UNAUTHENTICATED');
  });

  it('tái sử dụng chỉ thu hồi phiên bị lộ, phiên thiết bị khác vẫn sống', async () => {
    const phone = await t.login('iPhone');
    const tablet = await t.login('iPad');
    await t.refresh.execute({ refreshToken: phone.refreshToken });
    await t.refresh.execute({ refreshToken: phone.refreshToken });
    expect((await t.authenticate.execute(tablet.accessToken)).isOk()).toBe(true);
  });

  it('refresh token không tồn tại → UNAUTHENTICATED', async () => {
    expect(codeOf(await t.refresh.execute({ refreshToken: 'refresh-token-unknown' }))).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('refresh token quá hạn → TOKEN_EXPIRED', async () => {
    const first = await t.login();
    t.clock.advance({ days: REFRESH_TOKEN_TTL_DAYS });
    expect(codeOf(await t.refresh.execute({ refreshToken: first.refreshToken }))).toBe('TOKEN_EXPIRED');
  });

  it('phiên đã đăng xuất → UNAUTHENTICATED', async () => {
    const first = await t.login();
    await t.revoke.execute({ userId: USER, sessionId: first.sessionId, reason: 'LOGOUT' });
    expect(codeOf(await t.refresh.execute({ refreshToken: first.refreshToken }))).toBe('UNAUTHENTICATED');
  });
});

describe('AuthenticateUser', () => {
  it('access token hợp lệ, phiên còn hoạt động → userId + sessionId', async () => {
    const tokens = await t.login();
    const r = await t.authenticate.execute(tokens.accessToken);
    expect(r.isOk() && r.value).toEqual({ userId: USER, sessionId: tokens.sessionId });
  });

  it('quá 15 phút → TOKEN_EXPIRED', async () => {
    const tokens = await t.login();
    t.clock.advance({ seconds: ACCESS_TOKEN_TTL_SECONDS });
    expect(codeOf(await t.authenticate.execute(tokens.accessToken))).toBe('TOKEN_EXPIRED');
  });

  it('token rác → UNAUTHENTICATED', async () => {
    expect(codeOf(await t.authenticate.execute('garbage'))).toBe('UNAUTHENTICATED');
  });
});

describe('ListSessions / RevokeSession', () => {
  it('liệt kê phiên đang hoạt động, đánh dấu phiên hiện tại, bỏ phiên đã thu hồi', async () => {
    const a = await t.login('iPhone');
    t.clock.advance({ minutes: 1 });
    const b = await t.login('iPad');
    t.clock.advance({ minutes: 1 });
    const c = await t.login('Pixel');
    await t.revoke.execute({ userId: USER, sessionId: c.sessionId, reason: 'REVOKED_BY_USER' });

    const items = await t.list.execute({ userId: USER, currentSessionId: a.sessionId });
    expect(items.map((s) => [s.deviceName, s.current])).toEqual([
      ['iPad', false],
      ['iPhone', true],
    ]);
    expect(items.some((s) => s.id === b.sessionId)).toBe(true);
  });

  it('không thu hồi được phiên của người khác → NOT_FOUND', async () => {
    const other = await t.login('iPhone', newId<'User'>() as UserId);
    const r = await t.revoke.execute({ userId: USER, sessionId: other.sessionId, reason: 'REVOKED_BY_USER' });
    expect(codeOf(r)).toBe('NOT_FOUND');
    expect((await t.authenticate.execute(other.accessToken)).isOk()).toBe(true);
  });

  it('sessionId sai định dạng → NOT_FOUND', async () => {
    const r = await t.revoke.execute({ userId: USER, sessionId: 'abc', reason: 'LOGOUT' });
    expect(codeOf(r)).toBe('NOT_FOUND');
  });
});
