import { err, type DomainError, type Result } from '@tamgiao/kernel';
import type { KycSubmissionId, KycTransitionError } from '../../domain/kyc-submission.js';
import { RejectionReason } from '../../domain/rejection-reason.js';
import {
  runReviewAction,
  type ReviewActionDeps,
  type ReviewActionError,
  type ReviewActionView,
  type ReviewActor,
} from './run-review-action.js';

export interface RejectKycCommand {
  readonly submissionId: KycSubmissionId;
  readonly actor: ReviewActor;
  readonly reason: { readonly code: string; readonly note?: string | null | undefined };
}

export type RejectKycError =
  KycTransitionError | DomainError<'REJECTION_REASON_REQUIRED'> | ReviewActionError;

/**
 * Từ chối hồ sơ kèm lý do (`RejectionReason`). `KycRejected` (chỉ mang mã lý do) vào outbox cùng transaction
 * (AC3); audit chỉ ghi mã lý do, không ghi chú tự do (có thể chứa PII).
 */
export class RejectKyc {
  constructor(private readonly deps: ReviewActionDeps) {}

  async execute(cmd: RejectKycCommand): Promise<Result<ReviewActionView, RejectKycError>> {
    const reason = RejectionReason.create({ code: cmd.reason.code, note: cmd.reason.note ?? null });
    if (reason.isErr()) return err(reason.error);
    return runReviewAction(this.deps, cmd.submissionId, cmd.actor, {
      auditAction: 'kyc.reject',
      auditMeta: { reasonCode: reason.value.code },
      apply: (submission, now) => submission.reject(reason.value, cmd.actor.adminId, now),
    });
  }
}
