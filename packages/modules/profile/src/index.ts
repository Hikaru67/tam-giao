import { OutboxWriter } from '@tamgiao/db';
import type { AppEnv } from '@tamgiao/http';
import type { Clock, Encryptor, ObjectStorage, UnitOfWork, UploadRegistry } from '@tamgiao/kernel';
import type { BillingFacade } from '@tamgiao/module-billing/facade';
import type { VerificationFacade } from '@tamgiao/module-verification/facade';
import type { Hono, MiddlewareHandler } from 'hono';
import type { ProfileFacade } from './application/facade.js';
import { GetApplicantIdentity } from './application/get-applicant-identity.js';
import { GetMe } from './application/get-me.js';
import { GetProfile } from './application/get-profile.js';
import { GetPreferences, SavePreferences } from './application/preferences-use-cases.js';
import { SaveProfile } from './application/save-profile.js';
import { DrizzleApplicantDirectory } from './infrastructure/drizzle-applicant-directory.js';
import { DrizzleMatchingProfileReader } from './infrastructure/drizzle-matching-profile-reader.js';
import { DrizzlePreferencesRepository } from './infrastructure/drizzle-preferences-repository.js';
import { DrizzleProfileRepository } from './infrastructure/drizzle-profile-repository.js';
import { createMeRoutes } from './presentation/me-routes.js';
import { createPreferencesRoutes } from './presentation/preferences-routes.js';
import { createProfileRoutes } from './presentation/profile-routes.js';

export type {
  ApplicantIdentity,
  ApplicantSummary,
  MatchingCriteria,
  MatchingProfile,
  ProfileFacade,
} from './application/facade.js';

export interface ProfileModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly encryptor: Encryptor;
  /** Xác nhận key ảnh thuộc người dùng (BE-S2-07). */
  readonly uploads: UploadRegistry;
  readonly storage: ObjectStorage;
  /** Facade verification — trạng thái xác thực + huy hiệu cho `GET /me` (BE-S3-07). */
  readonly verification: VerificationFacade;
  /** Facade billing — đã thanh toán xác thực chưa cho `GET /me` (BE-S4-03). */
  readonly billing: BillingFacade;
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
      getMe: new GetMe({
        uow,
        clock,
        profiles,
        preferences,
        storage: deps.storage,
        verification: deps.verification,
        billing: deps.billing,
      }),
      requireUser: deps.requireUser,
    }),
  );
  const applicantIdentity = new GetApplicantIdentity({ uow, profiles });
  const applicantDirectory = new DrizzleApplicantDirectory(uow);
  const matchingProfiles = new DrizzleMatchingProfileReader(uow);
  const facade: ProfileFacade = {
    getApplicantIdentity: (userId) => applicantIdentity.execute(userId),
    searchUserIds: (text, limit) => applicantDirectory.searchUserIds(text, limit),
    getApplicantSummaries: (userIds) => applicantDirectory.getApplicantSummaries(userIds),
    getMatchingProfile: (userId) => matchingProfiles.getMatchingProfile(userId),
  };
  return { name: 'profile', routes, facade };
}

/**
 * Chỉ phần `getMatchingProfile` của facade (BE-S5-03) cho worker — consumer read model của matching dùng mà không
 * phải nối route/storage/`Encryptor` của cả module.
 */
export function createMatchingProfileReader(deps: {
  readonly uow: UnitOfWork;
}): Pick<ProfileFacade, 'getMatchingProfile'> {
  const reader = new DrizzleMatchingProfileReader(deps.uow);
  return { getMatchingProfile: (userId) => reader.getMatchingProfile(userId) };
}
