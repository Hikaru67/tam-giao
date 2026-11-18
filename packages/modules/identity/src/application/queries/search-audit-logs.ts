import { ok, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { AuditEntryState } from '../../domain/audit-entry.js';
import type { AuditLogCursor, AuditLogFilter, AuditLogRepository } from '../ports/audit-log-repository.js';

export const AUDIT_LOG_PAGE_DEFAULT = 50;
export const AUDIT_LOG_PAGE_MAX = 100;

export interface SearchAuditLogsQuery {
  readonly filter: AuditLogFilter;
  readonly cursor: AuditLogCursor | null;
  readonly limit?: number;
}

export interface AuditLogPage {
  readonly items: readonly AuditEntryState[];
  /** `null` khi đã hết dữ liệu. */
  readonly nextCursor: AuditLogCursor | null;
}

export interface SearchAuditLogsDeps {
  readonly uow: UnitOfWork;
  readonly auditLogs: AuditLogRepository;
}

/** Màn "Audit Trail" của admin: lọc theo actor / target / thời gian, mới nhất trước, phân trang cursor. */
export class SearchAuditLogs {
  constructor(private readonly deps: SearchAuditLogsDeps) {}

  async execute(query: SearchAuditLogsQuery): Promise<Result<AuditLogPage, never>> {
    const limit = Math.min(Math.max(query.limit ?? AUDIT_LOG_PAGE_DEFAULT, 1), AUDIT_LOG_PAGE_MAX);
    return this.deps.uow.run(async (tx) => {
      // Lấy dư 1 dòng để biết còn trang sau hay không.
      const rows = await this.deps.auditLogs.search(tx, query.filter, query.cursor, limit + 1);
      const items = rows.slice(0, limit).map((e) => e.toState());
      const last = items.at(-1);
      const nextCursor =
        rows.length > limit && last !== undefined ? { occurredAt: last.occurredAt, id: last.id } : null;
      return ok({ items, nextCursor });
    });
  }
}
