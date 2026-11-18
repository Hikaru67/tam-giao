import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type {
  AuditLogCursor,
  AuditLogFilter,
  AuditLogRepository,
} from '../application/ports/audit-log-repository.js';
import {
  AUDIT_ACTOR_TYPES,
  AuditEntry,
  type AuditActorType,
  type AuditEntryId,
  type AuditMeta,
} from '../domain/audit-entry.js';
import { auditLogs } from './schema.js';

const isActorType = (value: string): value is AuditActorType =>
  (AUDIT_ACTOR_TYPES as readonly string[]).includes(value);

export class DrizzleAuditLogRepository implements AuditLogRepository {
  async append(tx: Tx, entry: AuditEntry): Promise<void> {
    const s = entry.toState();
    await asDbTx(tx).insert(auditLogs).values({
      id: s.id,
      occurredAt: s.occurredAt,
      actorType: s.actor.type,
      actorId: s.actor.id,
      action: s.action,
      targetType: s.targetType,
      targetId: s.targetId,
      ip: s.ip,
      meta: s.meta,
    });
  }

  async search(
    tx: Tx,
    filter: AuditLogFilter,
    cursor: AuditLogCursor | null,
    limit: number,
  ): Promise<AuditEntry[]> {
    const conditions: (SQL | undefined)[] = [
      filter.actorType === undefined ? undefined : eq(auditLogs.actorType, filter.actorType),
      filter.actorId === undefined ? undefined : eq(auditLogs.actorId, filter.actorId),
      filter.action === undefined ? undefined : eq(auditLogs.action, filter.action),
      filter.targetType === undefined ? undefined : eq(auditLogs.targetType, filter.targetType),
      filter.targetId === undefined ? undefined : eq(auditLogs.targetId, filter.targetId),
      filter.from === undefined ? undefined : gte(auditLogs.occurredAt, filter.from),
      filter.to === undefined ? undefined : lt(auditLogs.occurredAt, filter.to),
      cursor === null
        ? undefined
        : sql`(${auditLogs.occurredAt}, ${auditLogs.id}) < (${cursor.occurredAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
    ];
    const rows = await asDbTx(tx)
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(limit);
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: typeof auditLogs.$inferSelect): AuditEntry {
    if (!isActorType(row.actorType)) {
      throw new Error(`identity.audit_logs ${row.id}: actor_type trong DB không hợp lệ`);
    }
    return AuditEntry.restore({
      id: row.id as AuditEntryId,
      occurredAt: row.occurredAt,
      actor: { type: row.actorType, id: row.actorId },
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      ip: row.ip,
      meta: row.meta as AuditMeta,
    });
  }
}
