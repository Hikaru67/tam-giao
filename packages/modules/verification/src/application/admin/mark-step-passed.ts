import { fail, type DomainError, type Result } from '@tamgiao/kernel';
import type {
  KycStep,
  KycStepOutcome,
  KycSubmissionId,
  KycTransitionError,
} from '../../domain/kyc-submission.js';
import {
  runReviewAction,
  type ReviewActionDeps,
  type ReviewActionError,
  type ReviewActionView,
  type ReviewActor,
} from './run-review-action.js';

export interface MarkStepPassedCommand {
  readonly submissionId: KycSubmissionId;
  readonly actor: ReviewActor;
  readonly step: KycStep;
  readonly outcome: KycStepOutcome;
}

export type MarkStepPassedError =
  KycTransitionError | DomainError<'KYC_CCCD_NUMBER_MISSING'> | ReviewActionError;

/**
 * Chuyên viên đánh dấu một bước đạt/không đạt (ghi đè kết quả cũ khi hồ sơ chưa quyết định).
 * - Hồ sơ còn nháp (`DRAFT`, người dùng chưa nộp) → `KYC_INVALID_TRANSITION`.
 * - Đánh `CCCD_CHIP` đạt khi hồ sơ chưa có số CCCD → `KYC_CCCD_NUMBER_MISSING`: số CCCD là thứ bảo đảm
 *   1 CCCD ↔ 1 tài khoản (unique blind index), không cho lách bằng ảnh mờ để OCR không ra số.
 */
export class MarkStepPassed {
  constructor(private readonly deps: ReviewActionDeps) {}

  execute(cmd: MarkStepPassedCommand): Promise<Result<ReviewActionView, MarkStepPassedError>> {
    return runReviewAction<MarkStepPassedError>(this.deps, cmd.submissionId, cmd.actor, {
      auditAction: 'kyc.mark_step',
      auditMeta: { step: cmd.step, outcome: cmd.outcome },
      apply: (submission, now) => {
        // Hồ sơ đã quyết định: để domain trả `KYC_ALREADY_DECIDED`.
        if (submission.isDecided) return submission.markStep(cmd.step, cmd.outcome, now);
        const s = submission.toState();
        if (s.status === 'DRAFT') {
          return fail('KYC_INVALID_TRANSITION', { action: 'markStep', status: s.status });
        }
        if (cmd.step === 'CCCD_CHIP' && cmd.outcome === 'PASSED' && s.cccdNumber === null) {
          return fail('KYC_CCCD_NUMBER_MISSING');
        }
        return submission.markStep(cmd.step, cmd.outcome, now);
      },
    });
  }
}
