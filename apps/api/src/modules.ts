import { HmacBlindIndexer, LocalKeyEncryptor, parseMasterKeyRing } from '@tamgiao/db';
import type { AppEnv } from '@tamgiao/http';
import type { Clock, UnitOfWork } from '@tamgiao/kernel';
import { ConsoleSmsSender, createIdentityModule } from '@tamgiao/module-identity';
import type { Hono } from 'hono';
import type { ApiConfig } from './config.js';

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

  return [identity];
}
