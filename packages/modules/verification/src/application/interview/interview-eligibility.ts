import { fail, ok, type DomainError, type Result, type Tx } from '@tamgiao/kernel';
import type { KycUserId } from '../../domain/kyc-submission.js';
import type { KycSubmissionRepository } from '../ports/kyc-submission-repository.js';

/**
 * Người dùng chỉ đặt/đổi lịch phỏng vấn khi hồ sơ eKYC đã nộp và chưa quyết định
 * (`INTERVIEW_REQUIRES_SUBMISSION`), và bước `INTERVIEW` chưa đạt (`INTERVIEW_ALREADY_PASSED`).
 * Bước `FAILED` vẫn được đặt lại (chuyên viên quyết định có phỏng vấn lại hay không).
 */
export async function ensureCanBookInterview(
  submissions: KycSubmissionRepository,
  tx: Tx,
  userId: KycUserId,
): Promise<Result<void, DomainError<'INTERVIEW_REQUIRES_SUBMISSION' | 'INTERVIEW_ALREADY_PASSED'>>> {
  const submission = await submissions.findByUserId(tx, userId);
  if (submission === null || submission.status === 'DRAFT' || submission.isDecided) {
    return fail('INTERVIEW_REQUIRES_SUBMISSION', { status: submission?.status ?? 'NOT_SUBMITTED' });
  }
  if (submission.steps.INTERVIEW.status === 'PASSED') return fail('INTERVIEW_ALREADY_PASSED');
  return ok();
}
