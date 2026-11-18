import { err, fail, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import {
  KYC_STEPS,
  type KycStatus,
  type KycStep,
  type KycStepStatus,
  type KycSteps,
  type KycSubmission,
  type KycSubmissionId,
} from '../../domain/kyc-submission.js';
import type { KycSaveError, KycSubmissionRepository } from '../ports/kyc-submission-repository.js';

/** Chuyên viên đang thao tác + IP request (ghi audit). */
export interface ReviewActor {
  readonly adminId: string;
  /** `c.get('clientIp')`; `unknown`/`null` = không xác định. */
  readonly ip: string | null;
}

export const KYC_AUDIT_TARGET_TYPE = 'kyc_submission';

/** Một bước kiểm tra, theo thứ tự `KYC_STEPS`. */
export interface KycStepView {
  readonly step: KycStep;
  readonly status: KycStepStatus;
  readonly decidedAt: Date | null;
}

export const toStepViews = (steps: KycSteps): readonly KycStepView[] =>
  KYC_STEPS.map((step) => ({ step, status: steps[step].status, decidedAt: steps[step].decidedAt }));

export interface ReviewActionDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly submissions: KycSubmissionRepository;
  readonly auditLogger: AuditLogger;
}

/** Kết quả trả về sau mỗi thao tác của chuyên viên (không chứa PII). */
export interface ReviewActionView {
  readonly id: KycSubmissionId;
  readonly status: KycStatus;
  readonly version: number;
  readonly steps: readonly KycStepView[];
  readonly reviewerId: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly updatedAt: Date;
}

export type ReviewActionError = DomainError<'KYC_SUBMISSION_NOT_FOUND'> | KycSaveError;

export interface ReviewAction<E> {
  /** `<miền>.<hành động>` ghi vào audit log, vd `kyc.approve`. */
  readonly auditAction: string;
  /** Meta audit — không chứa PII (không số CCCD, không ghi chú tự do). */
  readonly auditMeta: Readonly<Record<string, unknown>>;
  apply(submission: KycSubmission, now: Date): Result<void, E>;
}

/**
 * Khung chung của mọi thao tác chuyên viên trên một hồ sơ (BE-S3-04), trong **một** transaction:
 * khoá dòng (`SELECT … FOR UPDATE`) → luật domain → lưu (event vào outbox cùng `tx`, A6) → audit cùng `tx`.
 * Hai chuyên viên quyết định đồng thời chạy tuần tự nhờ khoá dòng; người sau thấy trạng thái đã quyết định
 * và nhận `KYC_ALREADY_DECIDED` từ domain.
 */
export async function runReviewAction<E>(
  deps: ReviewActionDeps,
  submissionId: KycSubmissionId,
  actor: ReviewActor,
  action: ReviewAction<E>,
): Promise<Result<ReviewActionView, E | ReviewActionError>> {
  return deps.uow.run(async (tx): Promise<Result<ReviewActionView, E | ReviewActionError>> => {
    const submission = await deps.submissions.findByIdForUpdate(tx, submissionId);
    if (submission === null) return fail('KYC_SUBMISSION_NOT_FOUND');

    const applied = action.apply(submission, deps.clock.now());
    if (applied.isErr()) return err(applied.error);

    // Lấy snapshot trước `save` (save rút event ra khỏi aggregate, không đổi state).
    const s = submission.toState();
    const saved = await deps.submissions.save(tx, submission);
    if (saved.isErr()) return err(saved.error);

    const audited = await deps.auditLogger.log(tx, {
      actor: { type: 'admin', id: actor.adminId },
      action: action.auditAction,
      targetType: KYC_AUDIT_TARGET_TYPE,
      targetId: s.id,
      ip: actor.ip,
      meta: { ...action.auditMeta, status: s.status },
    });
    // Audit sai định dạng là lỗi lập trình → throw để rollback cả thao tác (không quyết định mà không ghi vết).
    if (audited.isErr()) throw new Error(`audit log ${action.auditAction} rejected: ${audited.error.code}`);

    return ok({
      id: s.id,
      status: s.status,
      version: s.version,
      steps: toStepViews(s.steps),
      reviewerId: s.reviewerId,
      decidedBy: s.decidedBy,
      decidedAt: s.decidedAt,
      updatedAt: s.updatedAt,
    });
  });
}
