import type { Tx } from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';

/** Admin đang thao tác trên màn kiểm duyệt (BE-S6-06). */
export interface ModerationActor {
  readonly adminId: string;
  /** IP client; `null` = không rõ. */
  readonly ip: string | null;
}

/** `target_type` audit của module safety. */
export const SAFETY_AUDIT_TARGET = {
  report: 'safety_report',
  flaggedMessage: 'flagged_message',
  user: 'user',
} as const;

/** Action audit của module safety (BE-S6-06). */
export const SAFETY_AUDIT_ACTION = {
  viewReport: 'safety.report.view_detail',
  startReview: 'safety.report.start_review',
  closeReport: 'safety.report.close',
  viewFlaggedMessage: 'safety.flagged_message.view_detail',
  banUser: 'safety.user.ban',
} as const;

export interface ModerationAuditEntry {
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  /** Chỉ id / mã phân loại — không văn bản tự do (lý do, kết luận, nội dung tin). */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Ghi audit của thao tác kiểm duyệt. Có `tx` → commit/rollback cùng thao tác. Audit bị từ chối là lỗi lập trình
 * (meta sai dạng) → throw: không trả dữ liệu / không commit thao tác khi không ghi được vết (AGENTS.md mục 5).
 */
export async function auditModeration(
  logger: AuditLogger,
  tx: Tx | null,
  actor: ModerationActor,
  entry: ModerationAuditEntry,
): Promise<void> {
  const input = {
    actor: { type: 'admin' as const, id: actor.adminId },
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    ip: actor.ip,
    meta: entry.meta ?? {},
  };
  const result = tx === null ? await logger.log(input) : await logger.log(tx, input);
  if (result.isErr()) throw new Error(`audit log ${entry.action} rejected: ${result.error.code}`);
}
