import { ok, type Result, type UnitOfWork } from '@tamgiao/kernel';
import { ekycFlags, type EkycFlag } from '../../domain/ekyc-flags.js';
import type { KycStatus, KycSubmissionId } from '../../domain/kyc-submission.js';
import type { ApplicantDirectory } from '../ports/applicant-directory.js';
import type { KycQueueCursor, KycReviewQueue } from '../ports/kyc-review-queue.js';
import { toStepViews, type KycStepView } from './run-review-action.js';

export const KYC_QUEUE_PAGE_DEFAULT = 20;
export const KYC_QUEUE_PAGE_MAX = 100;
/** Hàng chờ mặc định: hồ sơ đang chờ chuyên viên xử lý. */
export const KYC_QUEUE_DEFAULT_STATUSES: readonly KycStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];
/**
 * Số người dùng tối đa lấy từ kết quả tìm theo tên/nghề. Đủ cho thao tác tra cứu của chuyên viên; tìm quá rộng
 * (vd 1 chữ cái) thì cần gõ cụ thể hơn.
 */
export const KYC_QUEUE_SEARCH_MAX_USERS = 500;

export interface GetKycReviewQueueQuery {
  /** Bỏ trống = `KYC_QUEUE_DEFAULT_STATUSES`. `DRAFT` bị bỏ qua (chưa nộp). */
  readonly statuses?: readonly KycStatus[];
  readonly flagged?: boolean;
  /** Tìm theo họ tên / nghề nghiệp (module profile). */
  readonly text?: string;
  readonly cursor: KycQueueCursor | null;
  readonly limit?: number;
}

export interface KycQueueItemView {
  readonly id: KycSubmissionId;
  readonly userId: string;
  readonly status: KycStatus;
  readonly fullName: string | null;
  readonly occupation: string | null;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly reviewerId: string | null;
  readonly flags: readonly EkycFlag[];
  readonly steps: readonly KycStepView[];
}

export interface KycQueuePage {
  readonly items: readonly KycQueueItemView[];
  /** `null` khi hết dữ liệu. */
  readonly nextCursor: KycQueueCursor | null;
}

export interface GetKycReviewQueueDeps {
  readonly uow: UnitOfWork;
  readonly queue: KycReviewQueue;
  readonly applicants: ApplicantDirectory;
}

/**
 * Cột hàng chờ của màn "Thẩm định eKYC" (BE-S3-04). Ưu tiên = hồ sơ chờ lâu nhất trước (`submittedAt` tăng dần,
 * bám SLA); bộ lọc `flagged` tách hồ sơ có cờ eKYC (từ chối / lỗi / lệch hồ sơ) để xử lý trước. Không ghi audit
 * (không chứa dữ liệu nhạy cảm — không số CCCD, không ảnh); xem chi tiết mới ghi.
 */
export class GetKycReviewQueue {
  constructor(private readonly deps: GetKycReviewQueueDeps) {}

  async execute(query: GetKycReviewQueueQuery): Promise<Result<KycQueuePage, never>> {
    const limit = Math.min(Math.max(query.limit ?? KYC_QUEUE_PAGE_DEFAULT, 1), KYC_QUEUE_PAGE_MAX);
    const requested = query.statuses?.length ? query.statuses : KYC_QUEUE_DEFAULT_STATUSES;
    const statuses = requested.filter((s) => s !== 'DRAFT');
    if (statuses.length === 0) return ok({ items: [], nextCursor: null });

    const text = query.text?.trim() ?? '';
    let userIds: readonly string[] | undefined;
    if (text.length > 0) {
      userIds = await this.deps.applicants.searchUserIds(text, KYC_QUEUE_SEARCH_MAX_USERS);
      if (userIds.length === 0) return ok({ items: [], nextCursor: null });
    }

    const found = await this.deps.uow.run(async (tx) =>
      ok(
        await this.deps.queue.search(
          tx,
          {
            statuses,
            ...(query.flagged === undefined ? {} : { flagged: query.flagged }),
            ...(userIds === undefined ? {} : { userIds }),
          },
          query.cursor,
          // Lấy dư 1 dòng để biết còn trang sau hay không.
          limit + 1,
        ),
      ),
    );
    const rows = found.isOk() ? found.value : [];
    const page = rows.slice(0, limit);

    const summaries = new Map(
      (await this.deps.applicants.getApplicantSummaries(page.map((r) => r.userId))).map((s) => [s.userId, s]),
    );
    const items = page.map((r): KycQueueItemView => ({
      id: r.id,
      userId: r.userId,
      status: r.status,
      fullName: summaries.get(r.userId)?.fullName ?? null,
      occupation: summaries.get(r.userId)?.occupation ?? null,
      submittedAt: r.submittedAt,
      updatedAt: r.updatedAt,
      reviewerId: r.reviewerId,
      flags: ekycFlags(r.ekycAssessment),
      steps: toStepViews(r.steps),
    }));
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last !== undefined ? { submittedAt: last.submittedAt, id: last.id } : null;
    return ok({ items, nextCursor });
  }
}
