import { refreshSessionBodySchema, requestOtpBodySchema, verifyOtpBodySchema } from '@tamgiao/contracts';
import { parseBody, problemResponse, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { AuthTokens } from '../application/session-issuer.js';
import type { ListSessions, RevokeSession } from '../application/use-cases/manage-sessions.js';
import type { RefreshSession } from '../application/use-cases/refresh-session.js';
import type { RequestOtp } from '../application/use-cases/request-otp.js';
import type { VerifyOtp } from '../application/use-cases/verify-otp.js';

export interface AuthRoutesDeps {
  readonly requestOtp: RequestOtp;
  readonly verifyOtp: VerifyOtp;
  readonly refreshSession: RefreshSession;
  readonly listSessions: ListSessions;
  readonly revokeSession: RevokeSession;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

const tokensDto = (t: AuthTokens) => ({
  ...t,
  refreshTokenExpiresAt: t.refreshTokenExpiresAt.toISOString(),
});

export function createAuthRoutes(deps: AuthRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post('/auth/otp/request', async (c) => {
    const body = await parseBody(c, requestOtpBodySchema);
    if (body.isErr()) return body.error;
    return sendResult(c, await deps.requestOtp.execute({ phone: body.value.phone, ip: c.get('clientIp') }));
  });

  routes.post('/auth/otp/verify', async (c) => {
    const body = await parseBody(c, verifyOtpBodySchema);
    if (body.isErr()) return body.error;
    const result = await deps.verifyOtp.execute(body.value);
    return sendResult(
      c,
      result.map((r) => ({ ...r, tokens: tokensDto(r.tokens) })),
    );
  });

  routes.post('/auth/refresh', async (c) => {
    const body = await parseBody(c, refreshSessionBodySchema);
    if (body.isErr()) return body.error;
    return sendResult(c, (await deps.refreshSession.execute(body.value)).map(tokensDto));
  });

  routes.post('/auth/logout', deps.requireUser, async (c) => {
    const { userId, sessionId } = c.get('auth');
    const result = await deps.revokeSession.execute({ userId, sessionId, reason: 'LOGOUT' });
    return result.isErr() ? problemResponse(c, result.error) : c.body(null, 204);
  });

  /** Danh sách thiết bị đang đăng nhập. */
  routes.get('/auth/sessions', deps.requireUser, async (c) => {
    const { userId, sessionId } = c.get('auth');
    const sessions = await deps.listSessions.execute({ userId, currentSessionId: sessionId });
    return c.json({
      items: sessions.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
      })),
    });
  });

  /** Đăng xuất một thiết bị khác từ xa. */
  routes.delete('/auth/sessions/:sessionId', deps.requireUser, async (c) => {
    const result = await deps.revokeSession.execute({
      userId: c.get('auth').userId,
      sessionId: c.req.param('sessionId'),
      reason: 'REVOKED_BY_USER',
    });
    return result.isErr() ? problemResponse(c, result.error) : c.body(null, 204);
  });

  return routes;
}
