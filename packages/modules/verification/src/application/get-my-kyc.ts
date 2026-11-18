import { ok, type UnitOfWork } from '@tamgiao/kernel';
import {
  KYC_STEPS,
  type KycStatus,
  type KycStep,
  type KycStepStatus,
  type KycSubmission,
  type MoreInfoItem,
} from '../domain/kyc-submission.js';
import type { RejectionReasonCode } from '../domain/rejection-reason.js';
import type { KycSubmissionRepository } from './ports/kyc-submission-repository.js';

/** Trạng thái hiển thị ở màn 6; `NOT_SUBMITTED` khi người dùng chưa nộp hồ sơ. */
export type KycProgressStatus = KycStatus | 'NOT_SUBMITTED';

export interface KycProgressView {
  readonly status: KycProgressStatus;
  readonly submittedAt: Date | null;
  readonly decidedAt: Date | null;
  /** Luôn đủ 4 bước theo thứ tự `KYC_STEPS`. */
  readonly steps: readonly {
    readonly step: KycStep;
    readonly status: KycStepStatus;
    readonly decidedAt: Date | null;
  }[];
  /** Tài liệu cần bổ sung — chỉ có khi `NEEDS_MORE_INFO`. */
  readonly moreInfo: { readonly items: readonly MoreInfoItem[]; readonly note: string | null } | null;
  /** Mã lý do khi `REJECTED` (ghi chú nội bộ của chuyên viên không trả cho người dùng). */
  readonly rejectionReason: RejectionReasonCode | null;
}

const NOT_SUBMITTED: KycProgressView = {
  status: 'NOT_SUBMITTED',
  submittedAt: null,
  decidedAt: null,
  steps: KYC_STEPS.map((step) => ({ step, status: 'PENDING', decidedAt: null })),
  moreInfo: null,
  rejectionReason: null,
};

/** Tiến trình thẩm định của chính người dùng (màn 6). Không bao giờ trả số CCCD hay điểm eKYC. */
export class GetMyKyc {
  constructor(
    private readonly deps: { readonly uow: UnitOfWork; readonly submissions: KycSubmissionRepository },
  ) {}

  async execute(userId: string): Promise<KycProgressView> {
    const result = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.submissions.findByUserId(tx, userId)),
    );
    const submission = result.isOk() ? result.value : null;
    return submission === null ? NOT_SUBMITTED : toView(submission);
  }
}

export function toView(submission: KycSubmission): KycProgressView {
  const s = submission.toState();
  return {
    status: s.status,
    submittedAt: s.submittedAt,
    decidedAt: s.decidedAt,
    steps: KYC_STEPS.map((step) => ({
      step,
      status: s.steps[step].status,
      decidedAt: s.steps[step].decidedAt,
    })),
    moreInfo:
      s.status === 'NEEDS_MORE_INFO' && s.moreInfoRequest !== null
        ? { items: [...s.moreInfoRequest.items], note: s.moreInfoRequest.note }
        : null,
    rejectionReason: s.status === 'REJECTED' ? (s.rejectionReason?.code ?? null) : null,
  };
}
