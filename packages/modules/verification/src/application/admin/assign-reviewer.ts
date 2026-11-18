import type { Result } from '@tamgiao/kernel';
import type { KycSubmissionId, KycTransitionError } from '../../domain/kyc-submission.js';
import {
  runReviewAction,
  type ReviewActionDeps,
  type ReviewActionError,
  type ReviewActionView,
  type ReviewActor,
} from './run-review-action.js';

export interface AssignReviewerCommand {
  readonly submissionId: KycSubmissionId;
  readonly actor: ReviewActor;
}

/**
 * Chuyên viên nhận xử lý hồ sơ (gán chính mình): `SUBMITTED → UNDER_REVIEW`; hồ sơ đang xét / chờ bổ sung thì
 * chỉ đổi người phụ trách. Ghi audit `kyc.assign_reviewer`.
 */
export class AssignReviewer {
  constructor(private readonly deps: ReviewActionDeps) {}

  execute(
    cmd: AssignReviewerCommand,
  ): Promise<Result<ReviewActionView, KycTransitionError | ReviewActionError>> {
    return runReviewAction(this.deps, cmd.submissionId, cmd.actor, {
      auditAction: 'kyc.assign_reviewer',
      auditMeta: { reviewerId: cmd.actor.adminId },
      apply: (submission, now) => submission.assignReviewer(cmd.actor.adminId, now),
    });
  }
}
