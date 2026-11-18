import type { Result } from '@tamgiao/kernel';
import type { KycMoreInfoError, KycSubmissionId, MoreInfoItem } from '../../domain/kyc-submission.js';
import {
  runReviewAction,
  type ReviewActionDeps,
  type ReviewActionError,
  type ReviewActionView,
  type ReviewActor,
} from './run-review-action.js';

export interface RequestMoreInfoCommand {
  readonly submissionId: KycSubmissionId;
  readonly actor: ReviewActor;
  readonly items: readonly MoreInfoItem[];
  readonly note?: string | null | undefined;
}

/** Yêu cầu người dùng bổ sung tài liệu: `UNDER_REVIEW → NEEDS_MORE_INFO`, `KycMoreInfoRequested` vào outbox. */
export class RequestMoreInfo {
  constructor(private readonly deps: ReviewActionDeps) {}

  execute(
    cmd: RequestMoreInfoCommand,
  ): Promise<Result<ReviewActionView, KycMoreInfoError | ReviewActionError>> {
    return runReviewAction(this.deps, cmd.submissionId, cmd.actor, {
      auditAction: 'kyc.request_more_info',
      auditMeta: { items: [...new Set(cmd.items)] },
      apply: (submission, now) =>
        submission.requestMoreInfo({ items: cmd.items, note: cmd.note ?? null }, now),
    });
  }
}
