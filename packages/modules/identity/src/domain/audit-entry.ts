import { err, fail, newId, ok, parseId, type DomainError, type Id, type Result } from '@tamgiao/kernel';

export type AuditEntryId = Id<'AuditEntry'>;

/** Ai thực hiện thao tác: cán bộ quản trị, người dùng app, hoặc hệ thống (job, consumer). */
export const AUDIT_ACTOR_TYPES = ['admin', 'user', 'system'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export interface AuditActor {
  readonly type: AuditActorType;
  /** Id admin/người dùng; `null` khi `type = 'system'`. */
  readonly id: string | null;
}

/** Giá trị JSON được phép trong `meta`. */
export type AuditMetaValue =
  string | number | boolean | null | readonly AuditMetaValue[] | { readonly [key: string]: AuditMetaValue };
export type AuditMeta = Readonly<Record<string, AuditMetaValue>>;

export interface AuditEntryState {
  readonly id: AuditEntryId;
  readonly occurredAt: Date;
  readonly actor: AuditActor;
  /** Dạng `<miền>.<hành động>`, vd `kyc.view_detail`, `billing.refund`. */
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly ip: string | null;
  readonly meta: AuditMeta;
}

export interface AuditEntryInput {
  readonly actor: { readonly type: string; readonly id?: string | null };
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly ip?: string | null;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Mảnh tên khoá bị cấm trong `meta` (so khớp sau khi bỏ ký tự không phải chữ/số và hạ chữ thường,
 * nên `phoneNumber`, `phone_number`, `PHONE` đều bị chặn). Audit log giữ lâu và nhiều người đọc →
 * không được chứa PII thô (Nghị định 13/2023, AGENTS.md mục 5). Cần ghi tham chiếu thì dùng id.
 */
export const AUDIT_META_FORBIDDEN_KEY_FRAGMENTS = [
  'phone',
  'sdt',
  'msisdn',
  'cccd',
  'cmnd',
  'nationalid',
  'idnumber',
  'idcard',
  'passport',
  'income',
  'salary',
  'asset',
  'housing',
  'photo',
  'image',
  'selfie',
  'avatar',
  'message',
  'chat',
  'password',
  'otp',
  'token',
  'secret',
  'email',
  'address',
  'birth',
  'dob',
  'fullname',
] as const;

export const AUDIT_META_MAX_DEPTH = 4;
export const AUDIT_META_MAX_BYTES = 4_096;

const ACTION_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const TARGET_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;
/** Id tham chiếu (uuid, mã đơn…), không cho văn bản tự do để tránh lọt PII. */
const TARGET_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const IP_PATTERN = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * Lỗi ghi audit là **lỗi lập trình của nơi gọi** (truyền sai action, cài PII vào meta) nên chỉ có một mã;
 * `details` cho biết trường + lý do (không bao giờ chứa giá trị).
 */
export type AuditEntryError = DomainError<'AUDIT_ENTRY_INVALID'>;

const invalid = (field: string, reason: string): Result<never, AuditEntryError> =>
  fail('AUDIT_ENTRY_INVALID', { field, reason });

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

export const isForbiddenMetaKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return AUDIT_META_FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Kiểm tra đệ quy: chỉ giá trị JSON, không khoá cấm, không quá sâu. Trả đường dẫn khoá lỗi. */
function checkMetaValue(value: unknown, path: string, depth: number): Result<void, AuditEntryError> {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return ok();
  if (typeof value === 'number') return Number.isFinite(value) ? ok() : invalid(path, 'NOT_JSON');
  if (depth >= AUDIT_META_MAX_DEPTH) return invalid(path, 'TOO_DEEP');
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const r = checkMetaValue(item, `${path}[${i}]`, depth + 1);
      if (r.isErr()) return r;
    }
    return ok();
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const keyPath = `${path}.${key}`;
      if (isForbiddenMetaKey(key)) return invalid(keyPath, 'FORBIDDEN_KEY');
      const r = checkMetaValue(item, keyPath, depth + 1);
      if (r.isErr()) return r;
    }
    return ok();
  }
  return invalid(path, 'NOT_JSON');
}

export function validateAuditMeta(meta: unknown): Result<AuditMeta, AuditEntryError> {
  if (!isPlainObject(meta)) return invalid('meta', 'NOT_OBJECT');
  const checked = checkMetaValue(meta, 'meta', 0);
  if (checked.isErr()) return err(checked.error);
  if (new TextEncoder().encode(JSON.stringify(meta)).length > AUDIT_META_MAX_BYTES) {
    return invalid('meta', 'TOO_LARGE');
  }
  return ok(meta as AuditMeta);
}

const isActorType = (value: string): value is AuditActorType =>
  (AUDIT_ACTOR_TYPES as readonly string[]).includes(value);

function parseActor(input: AuditEntryInput['actor']): Result<AuditActor, AuditEntryError> {
  if (!isActorType(input.type)) return invalid('actor.type', 'UNKNOWN');
  const rawId = input.id ?? null;
  if (input.type === 'system') {
    return rawId === null ? ok({ type: 'system', id: null }) : invalid('actor.id', 'MUST_BE_NULL');
  }
  if (rawId === null) return invalid('actor.id', 'REQUIRED');
  const id = parseId(rawId);
  if (id.isErr()) return invalid('actor.id', 'NOT_UUID_V7');
  return ok({ type: input.type, id: id.value });
}

/** Một bản ghi audit — bất biến, chỉ ghi thêm (bảng `identity.audit_logs` chặn UPDATE/DELETE ở DB). */
export class AuditEntry {
  private constructor(private readonly state: AuditEntryState) {}

  static create(input: AuditEntryInput, now: Date): Result<AuditEntry, AuditEntryError> {
    const actor = parseActor(input.actor);
    if (actor.isErr()) return err(actor.error);
    if (input.action.length > 100 || !ACTION_PATTERN.test(input.action)) {
      return invalid('action', 'BAD_FORMAT');
    }
    if (input.targetType.length > 50 || !TARGET_TYPE_PATTERN.test(input.targetType)) {
      return invalid('targetType', 'BAD_FORMAT');
    }
    if (!TARGET_ID_PATTERN.test(input.targetId)) return invalid('targetId', 'BAD_FORMAT');

    // `unknown` là giá trị requestContext dùng khi không xác định được IP.
    const rawIp = input.ip === 'unknown' ? null : (input.ip ?? null);
    if (rawIp !== null && !IP_PATTERN.test(rawIp)) return invalid('ip', 'BAD_FORMAT');

    const meta = validateAuditMeta(input.meta ?? {});
    if (meta.isErr()) return err(meta.error);

    return ok(
      new AuditEntry({
        id: newId<'AuditEntry'>(),
        occurredAt: now,
        actor: actor.value,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        ip: rawIp,
        meta: meta.value,
      }),
    );
  }

  static restore(state: AuditEntryState): AuditEntry {
    return new AuditEntry(state);
  }

  get id(): AuditEntryId {
    return this.state.id;
  }

  toState(): AuditEntryState {
    return this.state;
  }
}
