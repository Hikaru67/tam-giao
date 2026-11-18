import { updatePreferencesBodySchema, type PreferencesResponse } from '@tamgiao/contracts';
import { parseBody, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type {
  GetPreferences,
  PreferencesState,
  SavePreferences,
} from '../application/preferences-use-cases.js';

export interface PreferencesRoutesDeps {
  readonly savePreferences: SavePreferences;
  readonly getPreferences: GetPreferences;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

const toResponse = (s: PreferencesState): PreferencesResponse => ({
  userId: s.userId,
  ...s.criteria,
  area: { ...s.criteria.area },
  lifestyle: { ...s.criteria.lifestyle },
  coreTraits: [...s.criteria.coreTraits],
  updatedAt: s.updatedAt.toISOString(),
});

export function createPreferencesRoutes(deps: PreferencesRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/me/preferences', deps.requireUser, async (c) =>
    sendResult(c, (await deps.getPreferences.execute(c.get('auth').userId)).map(toResponse)),
  );

  routes.put('/me/preferences', deps.requireUser, async (c) => {
    const body = await parseBody(c, updatePreferencesBodySchema);
    if (body.isErr()) return body.error;
    const saved = await deps.savePreferences.execute({ userId: c.get('auth').userId, criteria: body.value });
    return sendResult(c, saved.map(toResponse));
  });

  return routes;
}
