import type { Result } from '@tamgiao/kernel';
import type { KycApproveError, KycSubmissionId } from '../../domain/kyc-submission.js';
import {
  runReviewAction,
  type ReviewActionDeps,
  type ReviewActionError,
  type ReviewActionView,
  type ReviewActor,
} from './run-review-action.js';

export interface ApproveKycCommand {
  readonly submissionId: KycSubmissionId;
  readonly actor: ReviewActor;
}

/**
 * Duyệt hồ sơ (cả 4 bước đã đạt). `KycApproved` vào outbox cùng transaction (AC3). Hai chuyên viên quyết định
 * đồng thời → người sau nhận `KYC_ALREADY_DECIDED` (AC2).
 */
export class ApproveKyc {
  constructor(private readonly deps: ReviewActionDeps) {}

  execute(cmd: ApproveKycCommand): Promise<Result<ReviewActionView, KycApproveError | ReviewActionError>> {
    return runReviewAction(this.deps, cmd.submissionId, cmd.actor, {
      auditAction: 'kyc.approve',
      auditMeta: {},
      apply: (submission, now) => submission.approve(cmd.actor.adminId, now),
    });
  }
}
