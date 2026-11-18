import { OutboxWriter } from '@tamgiao/db';
import { requireUser, type AppEnv } from '@tamgiao/http';
import type { BlindIndexer, Clock, Encryptor, UnitOfWork } from '@tamgiao/kernel';
import type { Hono } from 'hono';
import type { IdentityFacade } from './application/facade.js';
import type { SmsSender } from './application/ports/sms-sender.js';
import { AuthenticateUser } from './application/queries/authenticate-user.js';
import { SessionIssuer } from './application/session-issuer.js';
import { ListSessions, RevokeSession } from './application/use-cases/manage-sessions.js';
import { RefreshSession } from './application/use-cases/refresh-session.js';
import { RequestOtp } from './application/use-cases/request-otp.js';
import { VerifyOtp } from './application/use-cases/verify-otp.js';
import { deriveKey } from './infrastructure/derive-key.js';
import { DrizzleOtpChallengeRepository } from './infrastructure/drizzle-otp-challenge-repository.js';
import { DrizzleSessionRepository } from './infrastructure/drizzle-session-repository.js';
import { DrizzleUserRepository } from './infrastructure/drizzle-user-repository.js';
import { HmacOtpSecrets } from './infrastructure/hmac-otp-secrets.js';
import { Hs256AccessTokenService } from './infrastructure/hs256-access-token-service.js';
import { PostgresRateLimiter } from './infrastructure/postgres-rate-limiter.js';
import { RandomRefreshTokenSecrets } from './infrastructure/random-refresh-token-secrets.js';
import { createAuthRoutes } from './presentation/auth-routes.js';

export type { AuthenticatedUser, IdentityFacade } from './application/facade.js';
export type { SmsMessage, SmsSender } from './application/ports/sms-sender.js';
export { ConsoleSmsSender } from './infrastructure/console-sms-sender.js';

export interface IdentityModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly encryptor: Encryptor;
  readonly blindIndexer: BlindIndexer;
  readonly smsSender: SmsSender;
  /** Bí mật gốc (≥ 32 bytes) để dẫn xuất khoá băm OTP, khoá ký token… */
  readonly authSecret: Buffer;
}

export interface IdentityModule {
  readonly name: 'identity';
  readonly routes: Hono<AppEnv>;
  readonly facade: IdentityFacade;
}

/** Composition root của module identity. */
export function createIdentityModule(deps: IdentityModuleDeps): IdentityModule {
  const { uow, clock, blindIndexer } = deps;
  const users = new DrizzleUserRepository(deps.encryptor, blindIndexer, new OutboxWriter());
  const challenges = new DrizzleOtpChallengeRepository();
  const sessions = new DrizzleSessionRepository();
  const otpSecrets = new HmacOtpSecrets(deriveKey(deps.authSecret, 'otp'));
  const accessTokens = new Hs256AccessTokenService(deriveKey(deps.authSecret, 'access-token'));
  const refreshSecrets = new RandomRefreshTokenSecrets();
  const issuer = new SessionIssuer(sessions, accessTokens, refreshSecrets);

  const authenticateUser = new AuthenticateUser({ uow, clock, sessions, accessTokens });
  const facade: IdentityFacade = {
    authenticateUser: (accessToken) => authenticateUser.execute(accessToken),
  };

  const routes = createAuthRoutes({
    requestOtp: new RequestOtp({
      uow,
      clock,
      challenges,
      rateLimiter: new PostgresRateLimiter(),
      otpSecrets,
      sms: deps.smsSender,
      blindIndexer,
    }),
    verifyOtp: new VerifyOtp({ uow, clock, challenges, users, otpSecrets, blindIndexer, issuer }),
    refreshSession: new RefreshSession({ uow, clock, sessions, refreshSecrets, issuer }),
    listSessions: new ListSessions({ uow, clock, sessions }),
    revokeSession: new RevokeSession({ uow, clock, sessions }),
    requireUser: requireUser(facade.authenticateUser),
  });

  return { name: 'identity', routes, facade };
}
