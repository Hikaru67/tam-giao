import type { Tx } from '@tamgiao/kernel';
import type { ReportCategory, ReportSeverity, ReportStatus } from '../../domain/report.js';

/** Một dòng hàng chờ báo cáo — không có mô tả / bằng chứng (xem chi tiết mới ghi audit). */
export interface ReportQueueRow {
  readonly reportId: string;
  readonly reporterId: string;
  readonly reportedUserId: string;
  readonly matchId: string;
  readonly category: ReportCategory;
  readonly severity: ReportSeverity;
  readonly status: ReportStatus;
  readonly urgent: boolean;
  readonly dueAt: Date | null;
  readonly handledBy: string | null;
  readonly createdAt: Date;
}

export interface ReportQueueFilter {
  readonly statuses: readonly ReportStatus[];
  readonly limit: number;
  readonly offset: number;
}

export interface ReportQueuePageRows {
  readonly rows: readonly ReportQueueRow[];
  /** Tổng số báo cáo khớp bộ lọc (để phân trang). */
  readonly total: number;
}

/**
 * Đọc hàng chờ báo cáo cho admin (BE-S6-06). Thứ tự bắt buộc: `severity` giảm dần (CRITICAL trước), rồi `due_at`
 * tăng dần (không có hạn đứng cuối), rồi `created_at`, `id` tăng dần.
 */
export interface ReportQueue {
  list(tx: Tx, filter: ReportQueueFilter): Promise<ReportQueuePageRows>;
}
