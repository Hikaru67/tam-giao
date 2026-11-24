import type { ReportStatusName } from '@tamgiao/contracts/safety';

export interface SlaTarget {
  readonly urgent: boolean;
  readonly dueAt: string | null;
  readonly status: ReportStatusName;
  readonly overdue: boolean;
  readonly createdAt: string;
}

export type SlaResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'remaining'; readonly dueAt: string }
  | { readonly kind: 'overdue'; readonly dueAt: string };

/**
 * Tính trạng thái SLA của một báo cáo:
 * - dueAt null hoặc status RESOLVED / DISMISSED → 'none'
 * - overdue || now >= Date.parse(dueAt) → 'overdue'
 * - còn lại → 'remaining'
 */
export function slaState(report: SlaTarget, now: number): SlaResult {
  if (report.dueAt === null || report.status === 'RESOLVED' || report.status === 'DISMISSED') {
    return { kind: 'none' };
  }

  const dueTimestamp = Date.parse(report.dueAt);
  if (report.overdue || Number.isNaN(dueTimestamp) || now >= dueTimestamp) {
    return { kind: 'overdue', dueAt: report.dueAt };
  }

  return { kind: 'remaining', dueAt: report.dueAt };
}

/**
 * Sắp xếp danh sách hàng chờ:
 * Báo cáo khẩn cấp (`urgent === true`) lên đầu, giữ nguyên thứ tự BE trong từng nhóm (không mutate).
 */
export function sortQueue<T extends { readonly urgent: boolean }>(items: readonly T[]): readonly T[] {
  const urgentItems: T[] = [];
  const normalItems: T[] = [];

  for (const item of items) {
    if (item.urgent) {
      urgentItems.push(item);
    } else {
      normalItems.push(item);
    }
  }

  return [...urgentItems, ...normalItems];
}
