import { ok, type UnitOfWork } from '@tamgiao/kernel';
import type { KycStatus, KycStep, KycSubmission } from '../domain/kyc-submission.js';
import type {
  VerificationBadge,
  VerificationFacade,
  VerificationStatus,
  VerificationSummary,
} from './facade.js';
import type { KycSubmissionRepository } from './ports/kyc-submission-repository.js';

const STATUS_MAP: Readonly<Record<KycStatus, VerificationStatus>> = {
  DRAFT: 'NOT_SUBMITTED',
  SUBMITTED: 'IN_PROGRESS',
  UNDER_REVIEW: 'IN_PROGRESS',
  NEEDS_MORE_INFO: 'IN_PROGRESS',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

/** Thứ tự = thứ tự `VERIFICATION_BADGES`. */
const BADGE_STEPS: readonly (readonly [KycStep, VerificationBadge])[] = [
  ['CCCD_CHIP', 'CCCD_VERIFIED'],
  ['MARITAL_STATUS', 'SINGLE_VERIFIED'],
  ['INTERVIEW', 'INTERVIEWED'],
];

const NOT_SUBMITTED: VerificationSummary = { status: 'NOT_SUBMITTED', badges: [] };

/** Tổng hợp trạng thái + huy hiệu từ hồ sơ eKYC (thuần, không I/O). */
export function summarize(submission: KycSubmission | null): VerificationSummary {
  if (submission === null) return NOT_SUBMITTED;
  const status = STATUS_MAP[submission.status];
  const badges =
    status === 'REJECTED'
      ? []
      : BADGE_STEPS.filter(([step]) => submission.steps[step].status === 'PASSED').map(([, badge]) => badge);
  return { status, badges };
}

/** Hiện thực `VerificationFacade` — read-only, mỗi lời gọi một transaction ngắn. */
export class GetVerificationSummary implements VerificationFacade {
  constructor(
    private readonly deps: { readonly uow: UnitOfWork; readonly submissions: KycSubmissionRepository },
  ) {}

  async getSummary(userId: string): Promise<VerificationSummary> {
    const found = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.submissions.findByUserId(tx, userId)),
    );
    return summarize(found.unwrapOr(null));
  }

  async isVerified(userId: string): Promise<boolean> {
    return (await this.getSummary(userId)).status === 'APPROVED';
  }

  async getBadges(userId: string): Promise<readonly VerificationBadge[]> {
    return (await this.getSummary(userId)).badges;
  }
}
