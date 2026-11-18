import { submitKycBodySchema, type KycProgressResponse } from '@tamgiao/contracts';
import { parseBody, sendResult, type AppEnv } from '@tamgiao/http';
import { ok } from '@tamgiao/kernel';
import { Hono, type MiddlewareHandler } from 'hono';
import type { GetMyKyc, KycProgressView } from '../application/get-my-kyc.js';
import type { SubmitKyc } from '../application/submit-kyc.js';

export interface KycRoutesDeps {
  readonly submitKyc: SubmitKyc;
  readonly getMyKyc: GetMyKyc;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

const toResponse = (v: KycProgressView): KycProgressResponse => ({
  status: v.status,
  submittedAt: v.submittedAt?.toISOString() ?? null,
  decidedAt: v.decidedAt?.toISOString() ?? null,
  steps: v.steps.map((s) => ({
    step: s.step,
    status: s.status,
    decidedAt: s.decidedAt?.toISOString() ?? null,
  })),
  moreInfo: v.moreInfo && { items: [...v.moreInfo.items], note: v.moreInfo.note },
  rejectionReason: v.rejectionReason,
});

/** Route người dùng app của module verification (màn 5 nộp hồ sơ, màn 6 theo dõi tiến trình). */
export function createKycRoutes(deps: KycRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/me/kyc', deps.requireUser, async (c) => {
    const view = await deps.getMyKyc.execute(c.get('auth').userId);
    return sendResult(c, ok(toResponse(view)));
  });

  routes.post('/me/kyc', deps.requireUser, async (c) => {
    const body = await parseBody(c, submitKycBodySchema);
    if (body.isErr()) return body.error;
    const userId = c.get('auth').userId;

    const submitted = await deps.submitKyc.execute({ userId, documents: body.value });
    if (submitted.isErr()) return sendResult(c, submitted);
    return sendResult(c, ok(toResponse(await deps.getMyKyc.execute(userId))), 201);
  });

  return routes;
}
