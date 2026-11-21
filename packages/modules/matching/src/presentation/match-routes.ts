import {
  declineMatchBodySchema,
  matchProfileQuerySchema,
  type CurrentMatchResponse,
  type MatchProfileResponse,
  type MatchResponseResult,
} from '@tamgiao/contracts';
import { parseBody, parseQuery, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono, type MiddlewareHandler } from 'hono';
import type { GetCurrentMatchForUser } from '../application/queries/get-current-match-for-user.js';
import type { GetMatchProfile } from '../application/queries/get-match-profile.js';
import type { AcceptOffer } from '../application/responses/accept-offer.js';
import type { DeclineOffer } from '../application/responses/decline-offer.js';
import type { MatchResponseView } from '../application/responses/respond-to-open-match.js';
import type { WithdrawIntro } from '../application/responses/withdraw-intro.js';
import { toPhotoDto, toScoreDto } from './match-dto-mappers.js';

export interface MatchRoutesDeps {
  readonly getCurrentMatch: GetCurrentMatchForUser;
  readonly getMatchProfile: GetMatchProfile;
  readonly acceptOffer: AcceptOffer;
  readonly declineOffer: DeclineOffer;
  readonly withdrawIntro: WithdrawIntro;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

const toResponseResult = (v: MatchResponseView): MatchResponseResult => ({
  matchId: v.matchId,
  status: v.status,
  expiresAt: v.expiresAt?.toISOString() ?? null,
});

/**
 * Route ghép đôi của người dùng app (BE-S5-07): `GET /me/match`, `GET /me/match/profile`,
 * `POST /me/match/accept|decline|withdraw`. Lý do "Bỏ qua" là văn bản tự do (có thể chứa PII) — không log.
 */
export function createMatchRoutes(deps: MatchRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const user = deps.requireUser;

  routes.get('/me/match', user, async (c) => {
    const result = await deps.getCurrentMatch.execute({ userId: c.get('auth').userId });
    return sendResult(
      c,
      result.map((m): CurrentMatchResponse => ({
        match:
          m === null
            ? null
            : {
                matchId: m.matchId,
                status: m.status,
                phase: m.phase,
                expiresAt: m.expiresAt?.toISOString() ?? null,
                offeredAt: m.offeredAt.toISOString(),
                datingStartedAt: m.datingStartedAt?.toISOString() ?? null,
                score: toScoreDto(m.score),
                commonPoints: [...m.commonPoints],
                staffNote: m.staffNote,
                counterpart:
                  m.counterpart === null
                    ? null
                    : {
                        userId: m.counterpart.userId,
                        displayName: m.counterpart.displayName,
                        age: m.counterpart.age,
                        currentCity: m.counterpart.currentCity,
                        occupation: m.counterpart.occupation,
                        education: m.counterpart.education,
                        avatar: m.counterpart.avatar === null ? null : toPhotoDto(m.counterpart.avatar),
                      },
              },
      })),
    );
  });

  routes.get('/me/match/profile', user, async (c) => {
    const query = parseQuery(c, matchProfileQuerySchema);
    if (query.isErr()) return query.error;
    const result = await deps.getMatchProfile.execute({
      userId: c.get('auth').userId,
      ...(query.value.matchId === undefined ? {} : { matchId: query.value.matchId }),
    });
    return sendResult(
      c,
      result.map((m): MatchProfileResponse => ({
        matchId: m.matchId,
        status: m.status,
        phase: m.phase,
        expiresAt: m.expiresAt?.toISOString() ?? null,
        score: toScoreDto(m.score),
        commonPoints: [...m.commonPoints],
        counterpart: {
          userId: m.counterpart.userId,
          displayName: m.counterpart.displayName,
          age: m.counterpart.age,
          gender: m.counterpart.gender,
          currentCity: m.counterpart.currentCity,
          occupation: m.counterpart.occupation,
          education: m.counterpart.education,
          bio: m.counterpart.bio,
          interests: [...m.counterpart.interests],
          photos: m.counterpart.photos.map(toPhotoDto),
        },
      })),
    );
  });

  routes.post('/me/match/accept', user, async (c) => {
    const result = await deps.acceptOffer.execute({ userId: c.get('auth').userId });
    return sendResult(c, result.map(toResponseResult));
  });

  routes.post('/me/match/decline', user, async (c) => {
    // Body tuỳ chọn: không gửi body = không có lý do.
    const hasBody = (await c.req.text()).trim().length > 0;
    let reason: string | null = null;
    if (hasBody) {
      const body = await parseBody(c, declineMatchBodySchema);
      if (body.isErr()) return body.error;
      reason = body.value.reason ?? null;
    }
    const result = await deps.declineOffer.execute({ userId: c.get('auth').userId, reason });
    return sendResult(c, result.map(toResponseResult));
  });

  routes.post('/me/match/withdraw', user, async (c) => {
    const result = await deps.withdrawIntro.execute({ userId: c.get('auth').userId });
    return sendResult(c, result.map(toResponseResult));
  });

  return routes;
}
