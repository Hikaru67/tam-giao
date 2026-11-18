import { OutboxWriter } from '@tamgiao/db';
import type { AppEnv } from '@tamgiao/http';
import type { BlindIndexer, Clock, Encryptor, UnitOfWork, UploadRegistry } from '@tamgiao/kernel';
import type { Hono, MiddlewareHandler } from 'hono';
import type { VerificationFacade } from './application/facade.js';
import { GetMyKyc } from './application/get-my-kyc.js';
import type { ApplicantProfileReader } from './application/ports/applicant-profile-reader.js';
import type { EkycProvider } from './application/ports/ekyc-provider.js';
import { GetVerificationSummary } from './application/get-verification-summary.js';
import { SubmitKyc } from './application/submit-kyc.js';
import { DrizzleKycSubmissionRepository } from './infrastructure/drizzle-kyc-submission-repository.js';
import { createKycRoutes } from './presentation/kyc-routes.js';

export type {
  VerificationBadge,
  VerificationFacade,
  VerificationStatus,
  VerificationSummary,
} from './application/facade.js';
export type { ApplicantProfileReader } from './application/ports/applicant-profile-reader.js';
export { EkycProviderError, type EkycProvider } from './application/ports/ekyc-provider.js';
export {
  FakeEkycProvider,
  type FakeEkycProviderOptions,
  type FakeEkycScenario,
} from './infrastructure/ekyc/fake-ekyc-provider.js';
export {
  ResilientEkycProvider,
  type ResilientEkycOptions,
} from './infrastructure/ekyc/resilient-ekyc-provider.js';

export interface VerificationModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly encryptor: Encryptor;
  readonly blindIndexer: BlindIndexer;
  /** Xác nhận key ảnh thuộc người dùng (BE-S2-07). */
  readonly uploads: UploadRegistry;
  /** Nhà cung cấp eKYC (D2) — composition root bọc `ResilientEkycProvider` (timeout + retry). */
  readonly ekyc: EkycProvider;
  /** Họ tên + ngày sinh từ hồ sơ (facade profile) để đối chiếu với OCR. */
  readonly applicants: ApplicantProfileReader;
  /** Guard người dùng app — `requireUser(identity.facade.authenticateUser)`. */
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

export interface VerificationModule {
  readonly name: 'verification';
  readonly routes: Hono<AppEnv>;
  /** Facade read-only cho module khác (BE-S3-07). */
  readonly facade: VerificationFacade;
  // `handlers` (consumer event, BE-S4-03) thêm ở task tương ứng.
}

/** Composition root của module verification (eKYC, thẩm định độc thân, phỏng vấn sơ bộ). */
export function createVerificationModule(deps: VerificationModuleDeps): VerificationModule {
  const { uow, clock } = deps;
  const submissions = new DrizzleKycSubmissionRepository(
    deps.encryptor,
    deps.blindIndexer,
    new OutboxWriter(),
  );
  const routes = createKycRoutes({
    submitKyc: new SubmitKyc({
      uow,
      clock,
      submissions,
      uploads: deps.uploads,
      ekyc: deps.ekyc,
      applicants: deps.applicants,
    }),
    getMyKyc: new GetMyKyc({ uow, submissions }),
    requireUser: deps.requireUser,
  });
  const facade: VerificationFacade = new GetVerificationSummary({ uow, submissions });
  return { name: 'verification', routes, facade };
}
