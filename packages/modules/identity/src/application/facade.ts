import type { DomainError, Result, Tx } from '@tamgiao/kernel';

/**
 * API công khai của module identity cho module khác và composition root (AGENTS.md A3).
 * Chỉ chứa kiểu + thao tác chỉ-đọc; không lộ domain/infrastructure.
 */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly sessionId: string;
}

/** Cán bộ quản trị đã xác thực; `permissions` lấy theo bảng role → permission tại thời điểm request. */
export interface AuthenticatedAdmin {
  readonly adminId: string;
  readonly sessionId: string;
  readonly role: string;
  readonly permissions: readonly string[];
}

export interface IdentityFacade {
  /** Kiểm tra access token của người dùng app (chữ ký, hạn, phiên còn hiệu lực). */
  authenticateUser(accessToken: string): Promise<Result<AuthenticatedUser, DomainError>>;
  /** Kiểm tra token phiên admin (còn hạn, chưa thu hồi) và trả role + permission hiện hành. */
  authenticateAdmin(token: string): Promise<Result<AuthenticatedAdmin, DomainError>>;
}

/**
 * Một thao tác cần ghi vết (BE-S2-04). `meta` chỉ chứa dữ liệu không nhạy cảm — khoá có tên gợi PII
 * (`phone`, `cccd`, `income`, `email`, `message`…) bị từ chối với `AUDIT_ENTRY_INVALID`.
 */
export interface AuditLogInput {
  readonly actor: {
    readonly type: 'admin' | 'user' | 'system';
    /** UUID v7 của admin/người dùng; bỏ trống khi `type = 'system'`. */
    readonly id?: string | null;
  };
  /** `<miền>.<hành động>`, chữ thường + `_`, vd `kyc.view_detail`, `billing.refund`. */
  readonly action: string;
  /** vd `kyc_submission`, `user`, `payment`. */
  readonly targetType: string;
  readonly targetId: string;
  /** IP client (`c.get('clientIp')`); `unknown` được coi như không có. */
  readonly ip?: string | null;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Ghi audit log cho mọi module. Truyền `tx` để bản ghi audit commit/rollback cùng thao tác nghiệp vụ
 * (nên dùng cho thao tác ghi); không truyền thì tự mở transaction riêng.
 * `Err` = lỗi lập trình của nơi gọi (input sai định dạng / meta chứa PII), không phải lỗi người dùng.
 */
export interface AuditLogger {
  log(entry: AuditLogInput): Promise<Result<void, DomainError>>;
  log(tx: Tx, entry: AuditLogInput): Promise<Result<void, DomainError>>;
}

/**
 * Hợp đồng nguồn dữ liệu cá nhân cho file xuất (BE-S7-06): mỗi module hiện thực trong file riêng của mình, composition
 * root của worker truyền vào `createIdentityWorker({ dataExport })`.
 */
export type { PersonalDataFile, PersonalDataSection, PersonalDataSource } from './ports/data-rights.js';
