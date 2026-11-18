import type { MeResponse } from '@tamgiao/contracts';
import { sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { GetMe } from '../application/get-me.js';

export function createMeRoutes(deps: {
  readonly getMe: GetMe;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}) {
  const routes = new Hono<AppEnv>();
  routes.get('/me', deps.requireUser, async (c) => {
    const me = await deps.getMe.execute(c.get('auth').userId);
    return sendResult(
      c,
      me.map((m): MeResponse => ({ ...m, profile: m.profile && { ...m.profile }, badges: [...m.badges] })),
    );
  });
  return routes;
}
