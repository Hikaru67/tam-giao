import { OutboxWriter, type EventBus } from '@tamgiao/db';
import { createRequireAdmin, requireUser, type AppEnv, type RequireAdmin } from '@tamgiao/http';
import type { BlindIndexer, Clock, Encryptor, ObjectStorage, UnitOfWork } from '@tamgiao/kernel';
import type { Hono } from 'hono';
import type { AuditLogger, IdentityFacade } from './application/facade.js';
import type { SmsSender } from './application/ports/sms-sender.js';
import { AuthenticateAdmin } from './application/queries/authenticate-admin.js';
import { AuthenticateUser } from './application/queries/authenticate-user.js';
import { SearchAuditLogs } from './application/queries/search-audit-logs.js';
import { AdminLogin } from './application/use-cases/admin-login.js';
import { AdminLogout } from './application/use-cases/admin-logout.js';
import { BlockBannedUser } from './application/use-cases/block-banned-user.js';
import { CreateAdminUser } from './application/use-cases/create-admin-user.js';
import { SessionIssuer } from './application/session-issuer.js';
import { ListSessions, RevokeSession } from './application/use-cases/manage-sessions.js';
import { RecordAuditEntry } from './application/use-cases/record-audit-entry.js';
import { RefreshSession } from './application/use-cases/refresh-session.js';
import { RequestOtp } from './application/use-cases/request-otp.js';
import { VerifyOtp } from './application/use-cases/verify-otp.js';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher.js';
import { deriveKey } from './infrastructure/derive-key.js';
import { DrizzleAuditLogRepository } from './infrastructure/drizzle-audit-log-repository.js';
import { DrizzleBannedUserRegistry } from './infrastructure/drizzle-banned-user-registry.js';
import {
  DrizzleAdminSessionRepository,
  DrizzleAdminUserRepository,
} from './infrastructure/drizzle-admin-repositories.js';
import { DrizzleOtpChallengeRepository } from './infrastructure/drizzle-otp-challenge-repository.js';
import { DrizzleSessionRepository } from './infrastructure/drizzle-session-repository.js';
import { DrizzleUserRepository } from './infrastructure/drizzle-user-repository.js';
import { HmacOtpSecrets } from './infrastructure/hmac-otp-secrets.js';
import { Hs256AccessTokenService } from './infrastructure/hs256-access-token-service.js';
import { PostgresRateLimiter } from './infrastructure/postgres-rate-limiter.js';
import { RandomRefreshTokenSecrets } from './infrastructure/random-refresh-token-secrets.js';
import { Rfc6238Totp } from './infrastructure/rfc6238-totp.js';
import { registerUserBannedConsumer } from './infrastructure/user-banned-consumer.js';
import { createAdminAuthRoutes } from './presentation/admin-auth-routes.js';
import { createAuditRoutes } from './presentation/audit-routes.js';
import { createAuthRoutes } from './presentation/auth-routes.js';
import type { AccountDeletionStep, PersonalDataSource } from './application/ports/data-rights.js';
import { DownloadDataExport } from './application/queries/download-data-export.js';
import { GetAccountDeletionStatus } from './application/queries/get-account-deletion-status.js';
import { GetDataExport } from './application/queries/get-data-export.js';
import { BuildDataExport } from './application/use-cases/build-data-export.js';
import { DeleteAccount } from './application/use-cases/delete-account.js';
import { PurgeExpiredDataExports } from './application/use-cases/purge-expired-data-exports.js';
import { RequestAccountDeletionOtp } from './application/use-cases/request-account-deletion-otp.js';
import { RequestDataExport } from './application/use-cases/request-data-export.js';
import {
  IDENTITY_BUILD_DATA_EXPORT_CONSUMER,
  createIdentityPersonalDataSource,
  registerDataExportConsumer,
} from './infrastructure/data-rights-consumers.js';
import {
  DrizzleAccountDeletionRepository,
  DrizzleConsumerProgressReader,
  DrizzleDataExportRepository,
} from './infrastructure/drizzle-data-rights-repositories.js';
import { HmacDataExportLinkSigner } from './infrastructure/hmac-data-export-link-signer.js';
import { createDataRightsRoutes } from './presentation/data-rights-routes.js';

export type {
  AuditLogger,
  AuditLogInput,
  AuthenticatedAdmin,
  AuthenticatedUser,
  IdentityFacade,
} from './application/facade.js';
export type {
  CreateAdminUserCommand,
  CreateAdminUserError,
  CreateAdminUserResult,
} from './application/use-cases/create-admin-user.js';
export type { SmsMessage, SmsSender } from './application/ports/sms-sender.js';
export { ConsoleSmsSender } from './infrastructure/console-sms-sender.js';
export { IDENTITY_BLOCK_ON_USER_BANNED_CONSUMER } from './infrastructure/user-banned-consumer.js';
export { IDENTITY_BUILD_DATA_EXPORT_CONSUMER };
export type {
  AccountDeletionStep,
  PersonalDataFile,
  PersonalDataSection,
  PersonalDataSource,
} from './application/ports/data-rights.js';
export type { BuildDataExportOutcome } from './application/use-cases/build-data-export.js';
export { DATA_EXPORT_TTL_HOURS } from './domain/data-export.js';

export interface IdentityWorker {
  /**
   * Đăng ký consumer của identity (worker gọi trước `registerConsumers`): `UserBanned` → thu hồi phiên (BE-S6-06);
   * `DataExportRequested` → dựng file xuất dữ liệu (BE-S7-06, khi có `dataExport`).
   */
  registerConsumers(bus: EventBus): void;
}

export interface IdentityWorkerDeps {
  readonly clock: Clock;
  /**
   * Dựng file xuất dữ liệu cá nhân (BE-S7-06): `sources` = nguồn dữ liệu của các module khác (mục `account` của
   * identity tự thêm vào đầu).
   */
  readonly dataExport?: {
    readonly encryptor: Encryptor;
    readonly sources: readonly PersonalDataSource[];
  };
}

/**
 * Phần worker của module identity: `UserBanned` (safety) → chặn đăng nhập + thu hồi mọi phiên (BE-S6-06);
 * `DataExportRequested` → dựng file xuất dữ liệu (BE-S7-06).
 */
export function createIdentityWorker(deps: IdentityWorkerDeps): IdentityWorker {
  const blockBannedUser = new BlockBannedUser({
    clock: deps.clock,
    sessions: new DrizzleSessionRepository(),
    bannedUsers: new DrizzleBannedUserRegistry(),
  });
  const dataExport = deps.dataExport;
  return {
    registerConsumers: (bus) => {
      registerUserBannedConsumer(bus, blockBannedUser);
      if (dataExport) {
        const buildDataExport = new BuildDataExport({
          clock: deps.clock,
          dataExports: new DrizzleDataExportRepository(dataExport.encryptor, new OutboxWriter()),
          sources: [createIdentityPersonalDataSource(dataExport.encryptor), ...dataExport.sources],
        });
        registerDataExportConsumer(bus, buildDataExport);
      }
    },
  };
}

/** Job định kỳ xoá nội dung file xuất dữ liệu quá hạn tải (BE-S7-06). */
export function createDataExportPurgeJob(deps: {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly encryptor: Encryptor;
}): PurgeExpiredDataExports {
  return new PurgeExpiredDataExports({
    uow: deps.uow,
    clock: deps.clock,
    dataExports: new DrizzleDataExportRepository(deps.encryptor, new OutboxWriter()),
  });
}

export interface IdentityModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly encryptor: Encryptor;
  readonly blindIndexer: BlindIndexer;
  readonly smsSender: SmsSender;
  /** Bí mật gốc (≥ 32 bytes) để dẫn xuất khoá băm OTP, khoá ký token… */
  readonly authSecret: Buffer;
  /**
   * Quyền dữ liệu cá nhân (BE-S7-06) — có thì mount route xuất dữ liệu / xoá tài khoản. `storage` cấp presigned GET ảnh
   * khi tải file xuất; `accountDeletionSteps` = consumer `AccountDeletionRequested` của từng module (tiến độ xoá).
   */
  readonly dataRights?: {
    readonly storage: ObjectStorage;
    readonly accountDeletionSteps: readonly AccountDeletionStep[];
  };
}

export interface IdentityModule {
  readonly name: 'identity';
  readonly routes: Hono<AppEnv>;
  readonly facade: IdentityFacade;
  /** Guard cho route admin của mọi module: `requireAdmin('kyc:review')`. */
  readonly requireAdmin: RequireAdmin;
  /** Ghi audit log cho mọi module (BE-S2-04) — composition root truyền vào module cần ghi vết. */
  readonly auditLogger: AuditLogger;
  /** Thao tác chỉ dành cho CLI vận hành (không mở qua HTTP). */
  readonly commands: { readonly createAdminUser: CreateAdminUser };
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

  const admins = new DrizzleAdminUserRepository(deps.encryptor);
  const adminSessions = new DrizzleAdminSessionRepository();
  const passwords = new Argon2PasswordHasher();
  const totp = new Rfc6238Totp();

  const authenticateUser = new AuthenticateUser({ uow, clock, sessions, accessTokens });
  const authenticateAdmin = new AuthenticateAdmin({
    uow,
    clock,
    admins,
    sessions: adminSessions,
    tokens: refreshSecrets,
  });
  const facade: IdentityFacade = {
    authenticateUser: (accessToken) => authenticateUser.execute(accessToken),
    authenticateAdmin: (token) => authenticateAdmin.execute(token),
  };
  const requireAdmin = createRequireAdmin(facade.authenticateAdmin);

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
    verifyOtp: new VerifyOtp({
      uow,
      clock,
      challenges,
      users,
      otpSecrets,
      blindIndexer,
      issuer,
      bannedUsers: new DrizzleBannedUserRegistry(),
    }),
    refreshSession: new RefreshSession({ uow, clock, sessions, refreshSecrets, issuer }),
    listSessions: new ListSessions({ uow, clock, sessions }),
    revokeSession: new RevokeSession({ uow, clock, sessions }),
    requireUser: requireUser(facade.authenticateUser),
  });

  routes.route(
    '/',
    createAdminAuthRoutes({
      adminLogin: new AdminLogin({
        uow,
        clock,
        admins,
        sessions: adminSessions,
        passwords,
        totp,
        tokens: refreshSecrets,
      }),
      adminLogout: new AdminLogout({ uow, clock, sessions: adminSessions, tokens: refreshSecrets }),
      requireAdmin,
    }),
  );

  const auditLogs = new DrizzleAuditLogRepository();
  const auditLogger = new RecordAuditEntry({ uow, clock, auditLogs });
  routes.route(
    '/',
    createAuditRoutes({ searchAuditLogs: new SearchAuditLogs({ uow, auditLogs }), requireAdmin }),
  );

  if (deps.dataRights) {
    const { storage, accountDeletionSteps: steps } = deps.dataRights;
    const outbox = new OutboxWriter();
    const dataExports = new DrizzleDataExportRepository(deps.encryptor, outbox);
    const deletions = new DrizzleAccountDeletionRepository(outbox);
    const signer = new HmacDataExportLinkSigner(deriveKey(deps.authSecret, 'data-export-link'));
    routes.route(
      '/',
      createDataRightsRoutes({
        requestDataExport: new RequestDataExport({ uow, clock, users, dataExports, signer }),
        getDataExport: new GetDataExport({ uow, clock, dataExports, signer }),
        downloadDataExport: new DownloadDataExport({ uow, clock, dataExports, signer, storage }),
        requestAccountDeletionOtp: new RequestAccountDeletionOtp({
          uow,
          clock,
          users,
          challenges,
          rateLimiter: new PostgresRateLimiter(),
          otpSecrets,
          sms: deps.smsSender,
          blindIndexer,
        }),
        deleteAccount: new DeleteAccount({
          uow,
          clock,
          users,
          challenges,
          otpSecrets,
          sessions,
          deletions,
          dataExports,
          auditLogger,
          steps,
        }),
        getAccountDeletionStatus: new GetAccountDeletionStatus({
          uow,
          deletions,
          progress: new DrizzleConsumerProgressReader(),
          steps,
        }),
        requireUser: requireUser(facade.authenticateUser),
      }),
    );
  }

  const createAdminUser = new CreateAdminUser({ uow, clock, admins, passwords, totp });
  return { name: 'identity', routes, facade, requireAdmin, auditLogger, commands: { createAdminUser } };
}
