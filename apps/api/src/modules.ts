import { PRESIGNED_URL_TTL_SECONDS } from '@tamgiao/contracts';
import {
  HmacBlindIndexer,
  LocalKeyEncryptor,
  S3ObjectStorage,
  UploadService,
  parseMasterKeyRing,
} from '@tamgiao/db';
import { requireUser, type AppEnv } from '@tamgiao/http';
import type { Clock, UnitOfWork } from '@tamgiao/kernel';
import { ConsoleSmsSender, createIdentityModule } from '@tamgiao/module-identity';
import { createProfileModule } from '@tamgiao/module-profile';
import {
  FakeEkycProvider,
  ResilientEkycProvider,
  createVerificationModule,
} from '@tamgiao/module-verification';
import type { Hono } from 'hono';
import type { ApiConfig } from './config.js';
import { createUploadRoutes } from './http/uploads.js';

/**
 * Hợp đồng giữa composition root và từng module nghiệp vụ.
 * Mỗi module export `createXModule(deps)` từ `packages/modules/<x>/src/index.ts`;
 * route của module tự mang prefix của mình (vd `/me/match`, `/admin/matches`).
 */
export interface ApiModule {
  readonly name: string;
  readonly routes: Hono<AppEnv>;
}

export interface ModuleDeps {
  readonly config: ApiConfig;
  readonly uow: UnitOfWork;
  readonly clock: Clock;
}

/** Nối hạ tầng dùng chung vào từng module (thứ tự = thứ tự phụ thuộc giữa các module). */
export function buildModules({ config, uow, clock }: ModuleDeps): readonly ApiModule[] {
  const encryptor = new LocalKeyEncryptor(
    parseMasterKeyRing(config.crypto.masterKeys, config.crypto.masterKeyVersion),
  );
  const blindIndexer = new HmacBlindIndexer(config.crypto.blindIndexKey);

  const identity = createIdentityModule({
    uow,
    clock,
    encryptor,
    blindIndexer,
    // `SMS_PROVIDER` hiện chỉ có `console` (D4) — config đã chặn giá trị này ở production.
    smsSender: new ConsoleSmsSender(),
    authSecret: config.auth.secret,
  });

  // Upload qua presigned URL (BE-S2-07). `uploads` (UploadRegistry) sẽ truyền vào profile/verification/safety.
  const storage = new S3ObjectStorage({ ...config.storage, presignGetTtlSeconds: PRESIGNED_URL_TTL_SECONDS });
  const uploads = new UploadService({ uow, clock, storage, putTtlSeconds: PRESIGNED_URL_TTL_SECONDS });
  const userGuard = requireUser(identity.facade.authenticateUser);
  const uploadModule: ApiModule = {
    name: 'uploads',
    routes: createUploadRoutes({ uploads, requireUser: userGuard }),
  };

  const profile = createProfileModule({ uow, clock, encryptor, uploads, storage, requireUser: userGuard });

  // eKYC (D2 chưa chốt): `EKYC_PROVIDER=fake` — mỗi người dùng một số CCCD giả khác nhau (theo key ảnh).
  const ekyc = new ResilientEkycProvider(new FakeEkycProvider({ deriveCccdFromKey: true }), {
    timeoutMs: config.ekyc.timeoutMs,
    maxAttempts: config.ekyc.maxAttempts,
    backoffMs: config.ekyc.backoffMs,
  });
  const verification = createVerificationModule({
    uow,
    clock,
    encryptor,
    blindIndexer,
    uploads,
    ekyc,
    applicants: profile.facade,
    requireUser: userGuard,
    requireAdmin: identity.requireAdmin,
  });

  return [identity, uploadModule, profile, verification];
}
