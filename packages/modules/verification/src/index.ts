import { OutboxWriter } from '@tamgiao/db';
import type { AppEnv, RequireAdmin } from '@tamgiao/http';
import type {
  BlindIndexer,
  Clock,
  Encryptor,
  ObjectStorage,
  UnitOfWork,
  UploadRegistry,
} from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type { Hono, MiddlewareHandler } from 'hono';
import { ApproveKyc } from './application/admin/approve-kyc.js';
import { AssignReviewer } from './application/admin/assign-reviewer.js';
import { GetKycReviewDetail } from './application/admin/get-kyc-review-detail.js';
import { GetKycReviewQueue } from './application/admin/get-kyc-review-queue.js';
import { MarkStepPassed } from './application/admin/mark-step-passed.js';
import { RejectKyc } from './application/admin/reject-kyc.js';
import { RequestMoreInfo } from './application/admin/request-more-info.js';
import { GetMyKyc } from './application/get-my-kyc.js';
import type { ApplicantDirectory } from './application/ports/applicant-directory.js';
import type { ApplicantProfileReader } from './application/ports/applicant-profile-reader.js';
import type { EkycProvider } from './application/ports/ekyc-provider.js';
import { SubmitKyc } from './application/submit-kyc.js';
import { DrizzleKycReviewQueue } from './infrastructure/drizzle-kyc-review-queue.js';
import { DrizzleKycSubmissionRepository } from './infrastructure/drizzle-kyc-submission-repository.js';
import { createAdminKycRoutes } from './presentation/admin-kyc-routes.js';
import { createKycRoutes } from './presentation/kyc-routes.js';

export type { ApplicantDirectory, ApplicantSummary } from './application/ports/applicant-directory.js';
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
  /** Họ tên / nghề nghiệp người nộp cho hàng chờ duyệt (facade profile, BE-S3-04). */
  readonly applicantDirectory: ApplicantDirectory;
  /** Presigned GET ảnh bucket private cho chuyên viên (BE-S3-04). */
  readonly storage: ObjectStorage;
  /** Guard admin — `identity.requireAdmin` (BE-S3-04). */
  readonly requireAdmin: RequireAdmin;
  /** Ghi audit log — `identity.auditLogger` (BE-S3-04). */
  readonly auditLogger: AuditLogger;
}

export interface VerificationModule {
  readonly name: 'verification';
  readonly routes: Hono<AppEnv>;
  // `facade` (BE-S3-07) và `handlers` (consumer event, BE-S4-03) thêm ở task tương ứng.
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

  // Duyệt eKYC của admin (BE-S3-04).
  const review = { uow, clock, submissions, auditLogger: deps.auditLogger };
  routes.route(
    '/',
    createAdminKycRoutes({
      getQueue: new GetKycReviewQueue({
        uow,
        queue: new DrizzleKycReviewQueue(),
        applicants: deps.applicantDirectory,
      }),
      getDetail: new GetKycReviewDetail({
        uow,
        submissions,
        auditLogger: deps.auditLogger,
        storage: deps.storage,
        applicantIdentities: deps.applicants,
        applicantDirectory: deps.applicantDirectory,
      }),
      assignReviewer: new AssignReviewer(review),
      markStepPassed: new MarkStepPassed(review),
      approveKyc: new ApproveKyc(review),
      rejectKyc: new RejectKyc(review),
      requestMoreInfo: new RequestMoreInfo(review),
      requireAdmin: deps.requireAdmin,
    }),
  );
  return { name: 'verification', routes };
}
