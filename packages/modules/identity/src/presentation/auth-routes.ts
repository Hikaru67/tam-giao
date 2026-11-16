import { requestOtpBodySchema, verifyOtpBodySchema } from '@tamgiao/contracts';
import { parseBody, sendResult, type AppEnv } from '@tamgiao/http';
import { Hono } from 'hono';
import type { RequestOtp } from '../application/use-cases/request-otp.js';
import type { VerifyOtp } from '../application/use-cases/verify-otp.js';

export interface AuthRoutesDeps {
  readonly requestOtp: RequestOtp;
  readonly verifyOtp: VerifyOtp;
}

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
    return sendResult(c, await deps.verifyOtp.execute(body.value));
  });

  return routes;
}
