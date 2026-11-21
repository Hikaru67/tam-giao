import { ok, type Clock, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { ReportCategory, ReportSeverity, ReportStatus } from '../../domain/report.js';
import type { ReportQueue } from '../ports/report-queue.js';

export const REPORT_QUEUE_PAGE_DEFAULT = 20;
export const REPORT_QUEUE_PAGE_MAX = 100;
/** Hàng chờ mặc định: báo cáo chưa đóng. */
export const REPORT_QUEUE_DEFAULT_STATUSES: readonly ReportStatus[] = ['OPEN', 'IN_REVIEW'];

export interface GetReportQueueQuery {
  /** Bỏ trống = `REPORT_QUEUE_DEFAULT_STATUSES`. */
  readonly statuses?: readonly ReportStatus[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface ReportQueueItemView {
  readonly reportId: string;
  readonly reporterId: string;
  readonly reportedUserId: string;
  readonly matchId: string;
  readonly category: ReportCategory;
  readonly severity: ReportSeverity;
  readonly status: ReportStatus;
  readonly urgent: boolean;
  readonly dueAt: Date | null;
  /** Quá SLA: có hạn (`urgent`), chưa đóng và `dueAt` ≤ thời điểm truy vấn. */
  readonly overdue: boolean;
  readonly handledBy: string | null;
  readonly createdAt: Date;
}

export interface ReportQueuePage {
  readonly items: readonly ReportQueueItemView[];
  readonly total: number;
}

const OPEN_STATUSES: readonly ReportStatus[] = ['OPEN', 'IN_REVIEW'];

/**
 * Hàng chờ "Báo cáo Vi phạm & Khiếu nại" (BE-S6-06): sắp `severity` giảm dần + `dueAt` tăng dần (port `ReportQueue`),
 * đánh dấu `overdue` theo `Clock`. Không ghi audit — không có mô tả / bằng chứng (xem chi tiết mới ghi).
 */
export class GetReportQueue {
  constructor(
    private readonly deps: { readonly uow: UnitOfWork; readonly clock: Clock; readonly queue: ReportQueue },
  ) {}

  async execute(query: GetReportQueueQuery): Promise<Result<ReportQueuePage, never>> {
    const limit = Math.min(Math.max(query.limit ?? REPORT_QUEUE_PAGE_DEFAULT, 1), REPORT_QUEUE_PAGE_MAX);
    const offset = Math.max(query.offset ?? 0, 0);
    const statuses = query.statuses?.length ? query.statuses : REPORT_QUEUE_DEFAULT_STATUSES;
    const now = this.deps.clock.now();

    const found = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.queue.list(tx, { statuses, limit, offset })),
    );
    if (found.isErr()) throw new Error('unreachable');
    const { rows, total } = found.value;
    return ok({
      total,
      items: rows.map((r) => ({
        ...r,
        overdue: r.dueAt !== null && OPEN_STATUSES.includes(r.status) && r.dueAt.getTime() <= now.getTime(),
      })),
    });
  }
}
