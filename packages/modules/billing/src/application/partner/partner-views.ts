import { parseId, type Tx } from '@tamgiao/kernel';
import type { AuditLogger, AuditLogInput } from '@tamgiao/module-identity/facade';
import type { Partner, PartnerId, PartnerState } from '../../domain/partner.js';
import type { PartnerStaff, PartnerStaffId } from '../../domain/partner-staff.js';

/** Admin đang thao tác + IP request (ghi audit). */
export interface PartnerAdminActor {
  readonly adminId: string;
  /** `c.get('clientIp')`; `unknown`/`null` = không xác định. */
  readonly ip: string | null;
}

export type PartnerView = PartnerState;

/** Tài khoản nhân viên quán cho admin — không có hash PIN, bộ đếm sai, token version. */
export interface PartnerStaffView {
  readonly id: PartnerStaffId;
  readonly partnerId: PartnerId;
  readonly name: string;
  readonly deviceId: string | null;
  readonly active: boolean;
  /** `null` khi không bị khoá (hoặc khoá đã hết hạn). */
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const toPartnerView = (partner: Partner): PartnerView => partner.toState();

export function toPartnerStaffView(staff: PartnerStaff, now: Date): PartnerStaffView {
  const s = staff.toState();
  return {
    id: s.id,
    partnerId: s.partnerId,
    name: s.name,
    deviceId: s.deviceId,
    active: s.active,
    lockedUntil: staff.lockRemainingSeconds(now) > 0 ? s.lockedUntil : null,
    lastLoginAt: s.lastLoginAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Id từ path: không phải UUID v7 → `null` (caller trả NOT_FOUND, không để Postgres ném lỗi kiểu `uuid`). */
export function toPartnerId(raw: string): PartnerId | null {
  const id = parseId<'Partner'>(raw);
  return id.isOk() ? id.value : null;
}

export function toPartnerStaffId(raw: string): PartnerStaffId | null {
  const id = parseId<'PartnerStaff'>(raw);
  return id.isOk() ? id.value : null;
}

/** Ghi audit cùng `tx`; audit bị từ chối là lỗi lập trình → throw để rollback cả thao tác (không ghi mà thiếu vết). */
export async function auditPartnerAction(
  auditLogger: AuditLogger,
  tx: Tx,
  actor: PartnerAdminActor,
  entry: Omit<AuditLogInput, 'actor' | 'ip'>,
): Promise<void> {
  const audited = await auditLogger.log(tx, {
    ...entry,
    actor: { type: 'admin', id: actor.adminId },
    ip: actor.ip,
  });
  if (audited.isErr()) throw new Error(`audit log ${entry.action} rejected: ${audited.error.code}`);
}
