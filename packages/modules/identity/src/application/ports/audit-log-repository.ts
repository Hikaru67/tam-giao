import type { Tx } from '@tamgiao/kernel';
import type { AuditActorType, AuditEntry } from '../../domain/audit-entry.js';

export interface AuditLogFilter {
  readonly actorType?: AuditActorType | undefined;
  readonly actorId?: string | undefined;
  readonly action?: string | undefined;
  readonly targetType?: string | undefined;
  readonly targetId?: string | undefined;
  /** Bao gồm mốc này. */
  readonly from?: Date | undefined;
  /** Không bao gồm mốc này. */
  readonly to?: Date | undefined;
}

/** Vị trí bản ghi cuối của trang trước (sắp xếp `occurredAt` giảm dần, rồi `id` giảm dần). */
export interface AuditLogCursor {
  readonly occurredAt: Date;
  readonly id: string;
}

export interface AuditLogRepository {
  /** Chỉ ghi thêm — không có update/delete. */
  append(tx: Tx, entry: AuditEntry): Promise<void>;
  /** Bản ghi khớp `filter`, mới nhất trước, nằm sau `cursor` (nếu có), tối đa `limit` dòng. */
  search(tx: Tx, filter: AuditLogFilter, cursor: AuditLogCursor | null, limit: number): Promise<AuditEntry[]>;
}
