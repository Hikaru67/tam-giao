import { ok, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type {
  ReconciliationReportCursor,
  ReconciliationReportFilter,
  ReconciliationRepository,
} from '../ports/reconciliation-repository.js';
import { toReconciliationReportView, type ReconciliationReportView } from './reconciliation-views.js';

export const RECONCILIATION_PAGE_DEFAULT = 20;
export const RECONCILIATION_PAGE_MAX = 100;

export interface ListReconciliationReportsQuery {
  readonly filter: ReconciliationReportFilter;
  readonly cursor: ReconciliationReportCursor | null;
  readonly limit?: number;
}

export interface ReconciliationReportPage {
  readonly items: readonly ReconciliationReportView[];
  /** `null` khi đã hết dữ liệu. */
  readonly nextCursor: ReconciliationReportCursor | null;
}

export interface ListReconciliationReportsDeps {
  readonly uow: UnitOfWork;
  readonly reconciliation: ReconciliationRepository;
}

/** Admin xem lịch sử báo cáo đối soát (BE-S4-07): lọc theo status, mới nhất trước, phân trang cursor. */
export class ListReconciliationReports {
  constructor(private readonly deps: ListReconciliationReportsDeps) {}

  async execute(query: ListReconciliationReportsQuery): Promise<Result<ReconciliationReportPage, never>> {
    const limit = Math.min(Math.max(query.limit ?? RECONCILIATION_PAGE_DEFAULT, 1), RECONCILIATION_PAGE_MAX);
    return this.deps.uow.run(async (tx) => {
      // Lấy dư 1 dòng để biết còn trang sau hay không.
      const rows = await this.deps.reconciliation.list(tx, query.filter, query.cursor, limit + 1);
      const items = rows.slice(0, limit).map(toReconciliationReportView);
      const last = items.at(-1);
      const nextCursor =
        rows.length > limit && last !== undefined ? { runAt: last.runAt, id: last.id } : null;
      return ok({ items, nextCursor });
    });
  }
}
