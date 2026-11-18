import { OutboxWriter } from '@tamgiao/db';
import type { AppEnv } from '@tamgiao/http';
import type { Clock, Encryptor, ObjectStorage, UnitOfWork, UploadRegistry } from '@tamgiao/kernel';
import type { Hono, MiddlewareHandler } from 'hono';
import type { ProfileFacade } from './application/facade.js';
import { GetApplicantIdentity } from './application/get-applicant-identity.js';
import { GetMe } from './application/get-me.js';
import { GetProfile } from './application/get-profile.js';
import { GetPreferences, SavePreferences } from './application/preferences-use-cases.js';
import { SaveProfile } from './application/save-profile.js';
import { DrizzlePreferencesRepository } from './infrastructure/drizzle-preferences-repository.js';
import { DrizzleProfileRepository } from './infrastructure/drizzle-profile-repository.js';
import { createMeRoutes } from './presentation/me-routes.js';
import { createPreferencesRoutes } from './presentation/preferences-routes.js';
import { createProfileRoutes } from './presentation/profile-routes.js';

export type { ApplicantIdentity, ProfileFacade } from './application/facade.js';

export interface ProfileModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly encryptor: Encryptor;
  /** Xác nhận key ảnh thuộc người dùng (BE-S2-07). */
  readonly uploads: UploadRegistry;
  readonly storage: ObjectStorage;
  /** Guard người dùng app — `requireUser(identity.facade.authenticateUser)`. */
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

export interface ProfileModule {
  readonly name: 'profile';
  readonly routes: Hono<AppEnv>;
  readonly facade: ProfileFacade;
}

/** Composition root của module profile (module "mỏng", AGENTS.md A11). */
export function createProfileModule(deps: ProfileModuleDeps): ProfileModule {
  const { uow, clock } = deps;
  const outbox = new OutboxWriter();
  const profiles = new DrizzleProfileRepository(deps.encryptor, outbox);
  const preferences = new DrizzlePreferencesRepository(outbox);
  const routes = createProfileRoutes({
    saveProfile: new SaveProfile({ uow, clock, profiles, uploads: deps.uploads }),
    getProfile: new GetProfile({ uow, profiles, storage: deps.storage }),
    requireUser: deps.requireUser,
  });
  routes.route(
    '/',
    createPreferencesRoutes({
      savePreferences: new SavePreferences({ uow, clock, preferences }),
      getPreferences: new GetPreferences({ uow, preferences }),
      requireUser: deps.requireUser,
    }),
  );
  routes.route(
    '/',
    createMeRoutes({
      getMe: new GetMe({ uow, clock, profiles, preferences, storage: deps.storage }),
      requireUser: deps.requireUser,
    }),
  );
  const applicantIdentity = new GetApplicantIdentity({ uow, profiles });
  const facade: ProfileFacade = {
    getApplicantIdentity: (userId) => applicantIdentity.execute(userId),
  };
  return { name: 'profile', routes, facade };
}
