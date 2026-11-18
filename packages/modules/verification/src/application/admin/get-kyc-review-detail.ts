import {
  err,
  fail,
  ok,
  type DomainError,
  type ObjectStorage,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import { ekycFlags, type EkycFlag } from '../../domain/ekyc-flags.js';
import type {
  EkycAssessment,
  KycStatus,
  KycSubmissionId,
  MoreInfoRequest,
} from '../../domain/kyc-submission.js';
import type { RejectionReasonCode } from '../../domain/rejection-reason.js';
import type { ApplicantDirectory } from '../ports/applicant-directory.js';
import type { ApplicantProfileReader } from '../ports/applicant-profile-reader.js';
import type { KycSubmissionRepository } from '../ports/kyc-submission-repository.js';
import {
  KYC_AUDIT_TARGET_TYPE,
  toStepViews,
  type KycStepView,
  type ReviewActor,
} from './run-review-action.js';

export interface PresignedDocument {
  readonly url: string;
  readonly expiresAt: Date;
}

/** Chi tiết hồ sơ cho chuyên viên. **Chứa PII** (số CCCD đầy đủ, họ tên, ngày sinh, link ảnh) — không log. */
export interface KycReviewDetailView {
  readonly id: KycSubmissionId;
  readonly userId: string;
  readonly status: KycStatus;
  readonly version: number;
  readonly applicant: {
    readonly fullName: string | null;
    readonly birthDate: string | null;
    readonly occupation: string | null;
  };
  readonly cccdNumber: string | null;
  /** Presigned GET (TTL do adapter, `PRESIGNED_URL_TTL_SECONDS`); `null` khi ảnh đã bị xoá theo thời hạn lưu. */
  readonly documents: {
    readonly cccdFront: PresignedDocument | null;
    readonly cccdBack: PresignedDocument | null;
    readonly selfie: PresignedDocument | null;
    readonly maritalStatusCertificate: PresignedDocument | null;
  };
  readonly ekycAssessment: EkycAssessment | null;
  readonly flags: readonly EkycFlag[];
  readonly steps: readonly KycStepView[];
  readonly reviewerId: string | null;
  readonly moreInfoRequest: MoreInfoRequest | null;
  readonly rejection: { readonly code: RejectionReasonCode; readonly note: string | null } | null;
  readonly decidedBy: string | null;
  readonly submittedAt: Date | null;
  readonly decidedAt: Date | null;
  readonly updatedAt: Date;
}

export interface GetKycReviewDetailQuery {
  readonly submissionId: KycSubmissionId;
  readonly actor: ReviewActor;
}

export interface GetKycReviewDetailDeps {
  readonly uow: UnitOfWork;
  readonly submissions: KycSubmissionRepository;
  readonly auditLogger: AuditLogger;
  readonly storage: ObjectStorage;
  readonly applicantIdentities: ApplicantProfileReader;
  readonly applicantDirectory: ApplicantDirectory;
}

/**
 * Panel chi tiết của màn "Thẩm định eKYC" (BE-S3-04): giải mã số CCCD (trả đủ để chuyên viên đối chiếu),
 * presigned GET ảnh bucket private, đánh giá eKYC, các bước. **Mỗi lần xem ghi 1 bản ghi audit**
 * `kyc.view_detail` trong cùng transaction với lần đọc (AC1, AGENTS.md mục 5) — ghi audit lỗi thì không trả dữ liệu.
 */
export class GetKycReviewDetail {
  constructor(private readonly deps: GetKycReviewDetailDeps) {}

  async execute(
    query: GetKycReviewDetailQuery,
  ): Promise<Result<KycReviewDetailView, DomainError<'KYC_SUBMISSION_NOT_FOUND'>>> {
    const found = await this.deps.uow.run(async (tx) => {
      const submission = await this.deps.submissions.findById(tx, query.submissionId);
      if (submission === null) return fail('KYC_SUBMISSION_NOT_FOUND');
      const s = submission.toState();
      const audited = await this.deps.auditLogger.log(tx, {
        actor: { type: 'admin', id: query.actor.adminId },
        action: 'kyc.view_detail',
        targetType: KYC_AUDIT_TARGET_TYPE,
        targetId: s.id,
        ip: query.actor.ip,
        meta: { status: s.status },
      });
      if (audited.isErr()) throw new Error(`audit log kyc.view_detail rejected: ${audited.error.code}`);
      return ok(s);
    });
    if (found.isErr()) return err(found.error);
    const s = found.value;

    const presign = async (key: string | undefined): Promise<PresignedDocument | null> => {
      if (key === undefined) return null;
      const signed = await this.deps.storage.presignGet({ bucket: 'privateKyc', key });
      return { url: signed.url, expiresAt: signed.expiresAt };
    };
    const [cccdFront, cccdBack, selfie, maritalStatusCertificate, identity, summaries] = await Promise.all([
      presign(s.documents?.cccdFrontKey),
      presign(s.documents?.cccdBackKey),
      presign(s.documents?.selfieKey),
      presign(s.documents?.maritalStatusCertificateKey),
      this.deps.applicantIdentities.getApplicantIdentity(s.userId),
      this.deps.applicantDirectory.getApplicantSummaries([s.userId]),
    ]);
    const summary = summaries.find((x) => x.userId === s.userId);

    return ok({
      id: s.id,
      userId: s.userId,
      status: s.status,
      version: s.version,
      applicant: {
        fullName: summary?.fullName ?? identity?.fullName ?? null,
        birthDate: identity?.birthDate ?? null,
        occupation: summary?.occupation ?? null,
      },
      cccdNumber: s.cccdNumber?.value ?? null,
      documents: { cccdFront, cccdBack, selfie, maritalStatusCertificate },
      ekycAssessment: s.ekycAssessment,
      flags: ekycFlags(s.ekycAssessment),
      steps: toStepViews(s.steps),
      reviewerId: s.reviewerId,
      moreInfoRequest: s.moreInfoRequest,
      rejection: s.rejectionReason && { code: s.rejectionReason.code, note: s.rejectionReason.note },
      decidedBy: s.decidedBy,
      submittedAt: s.submittedAt,
      decidedAt: s.decidedAt,
      updatedAt: s.updatedAt,
    });
  }
}
