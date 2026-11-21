import { addDuration, Entity, fail, ok, type DomainError, type Id, type Result } from '@tamgiao/kernel';
import { PARTNER_NAME_MAX_LENGTH, type Partner, type PartnerId } from './partner.js';

export type PartnerStaffId = Id<'PartnerStaff'>;

/** PIN nhân viên quán: đúng 6 chữ số (giữ khớp `PARTNER_PIN_PATTERN` ở contracts, có test). */
export const PARTNER_PIN_PATTERN = /^\d{6}$/;
/** Sai PIN/thiết bị liên tiếp lần thứ `PARTNER_MAX_FAILED_LOGINS` → khoá `PARTNER_LOCK_MINUTES` phút (như admin). */
export const PARTNER_MAX_FAILED_LOGINS = 5;
export const PARTNER_LOCK_MINUTES = 15;
/** Hạn token partner: một ca làm việc. Thu hồi sớm khi tắt quán / vô hiệu hoá / đổi PIN hoặc thiết bị. */
export const PARTNER_STAFF_TOKEN_TTL_HOURS = 8;

export const isValidPartnerPin = (pin: string): boolean => PARTNER_PIN_PATTERN.test(pin);

export interface PartnerStaffState {
  readonly id: PartnerStaffId;
  readonly partnerId: PartnerId;
  readonly name: string;
  /** Hash PIN (scrypt + pepper ở infrastructure) — không bao giờ lưu/log PIN gốc. */
  readonly pinHash: string;
  /** Thiết bị được phép đăng nhập; `null` = gắn ở lần đăng nhập thành công đầu tiên. */
  readonly deviceId: string | null;
  readonly active: boolean;
  readonly failedLogins: number;
  readonly lockedUntil: Date | null;
  /** Tăng khi đổi PIN / thiết bị / vô hiệu hoá → token partner mang version cũ bị từ chối. */
  readonly tokenVersion: number;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type PartnerLoginError = DomainError<'PARTNER_LOGIN_FAILED' | 'PARTNER_STAFF_LOCKED'>;

function staffName(value: string): Result<string, DomainError<'PARTNER_INVALID'>> {
  const v = value.trim();
  return v.length === 0 || v.length > PARTNER_NAME_MAX_LENGTH
    ? fail('PARTNER_INVALID', { field: 'name' })
    : ok(v);
}

/** Tài khoản nhân viên quán (BE-S4-06): đăng nhập bằng PIN trên thiết bị đã đăng ký để quét QR voucher. */
export class PartnerStaff extends Entity<PartnerStaffId> {
  private constructor(private state: PartnerStaffState) {
    super(state.id);
  }

  static create(
    input: {
      readonly id: PartnerStaffId;
      readonly partnerId: PartnerId;
      readonly name: string;
      readonly pinHash: string;
      readonly deviceId?: string | null;
    },
    now: Date,
  ): Result<PartnerStaff, DomainError<'PARTNER_INVALID'>> {
    const name = staffName(input.name);
    if (name.isErr()) return fail(name.error.code, name.error.details);
    return ok(
      new PartnerStaff({
        id: input.id,
        partnerId: input.partnerId,
        name: name.value,
        pinHash: input.pinHash,
        deviceId: input.deviceId ?? null,
        active: true,
        failedLogins: 0,
        lockedUntil: null,
        tokenVersion: 1,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  static restore(state: PartnerStaffState): PartnerStaff {
    return new PartnerStaff({ ...state });
  }

  get partnerId(): PartnerId {
    return this.state.partnerId;
  }

  get name(): string {
    return this.state.name;
  }

  get pinHash(): string {
    return this.state.pinHash;
  }

  get active(): boolean {
    return this.state.active;
  }

  get tokenVersion(): number {
    return this.state.tokenVersion;
  }

  /** Số giây còn bị khoá (0 = không khoá). */
  lockRemainingSeconds(now: Date): number {
    const until = this.state.lockedUntil;
    if (until === null || until <= now) return 0;
    return Math.ceil((until.getTime() - now.getTime()) / 1_000);
  }

  /**
   * Một lần đăng nhập: đang khoá → `PARTNER_STAFF_LOCKED` (không đếm thêm). Sai PIN hoặc khác thiết bị đã đăng ký →
   * đếm lần sai, lần thứ `PARTNER_MAX_FAILED_LOGINS` khoá `PARTNER_LOCK_MINUTES` phút; hết khoá thì đếm lại từ 0.
   * Đúng → xoá bộ đếm, gắn thiết bị nếu chưa có. Caller phải lưu lại entity dù kết quả là lỗi.
   */
  login(
    input: { readonly pinMatches: boolean; readonly deviceId: string },
    now: Date,
  ): Result<void, PartnerLoginError> {
    const locked = this.lockRemainingSeconds(now);
    if (locked > 0) return fail('PARTNER_STAFF_LOCKED', { retryAfterSeconds: locked });

    const deviceMatches = this.state.deviceId === null || this.state.deviceId === input.deviceId;
    if (!input.pinMatches || !deviceMatches) {
      const previous = this.state.lockedUntil === null ? this.state.failedLogins : 0;
      const failedLogins = previous + 1;
      if (failedLogins >= PARTNER_MAX_FAILED_LOGINS) {
        this.state = {
          ...this.state,
          failedLogins: 0,
          lockedUntil: addDuration(now, { minutes: PARTNER_LOCK_MINUTES }),
          updatedAt: now,
        };
        return fail('PARTNER_STAFF_LOCKED', { retryAfterSeconds: PARTNER_LOCK_MINUTES * 60 });
      }
      this.state = { ...this.state, failedLogins, lockedUntil: null, updatedAt: now };
      return fail('PARTNER_LOGIN_FAILED');
    }

    this.state = {
      ...this.state,
      deviceId: this.state.deviceId ?? input.deviceId,
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: now,
      updatedAt: now,
    };
    return ok();
  }

  rename(name: string, now: Date): Result<boolean, DomainError<'PARTNER_INVALID'>> {
    const v = staffName(name);
    if (v.isErr()) return fail(v.error.code, v.error.details);
    if (v.value === this.state.name) return ok(false);
    this.state = { ...this.state, name: v.value, updatedAt: now };
    return ok(true);
  }

  /** Admin đặt lại PIN: mở khoá, xoá bộ đếm sai, thu hồi token cũ. */
  resetPin(pinHash: string, now: Date): void {
    this.state = {
      ...this.state,
      pinHash,
      failedLogins: 0,
      lockedUntil: null,
      tokenVersion: this.state.tokenVersion + 1,
      updatedAt: now,
    };
  }

  /** Đổi thiết bị (`null` = gắn lại ở lần đăng nhập tới) → thu hồi token cũ. */
  changeDevice(deviceId: string | null, now: Date): boolean {
    if (deviceId === this.state.deviceId) return false;
    this.state = { ...this.state, deviceId, tokenVersion: this.state.tokenVersion + 1, updatedAt: now };
    return true;
  }

  setActive(active: boolean, now: Date): boolean {
    if (active === this.state.active) return false;
    this.state = {
      ...this.state,
      active,
      tokenVersion: active ? this.state.tokenVersion : this.state.tokenVersion + 1,
      updatedAt: now,
    };
    return true;
  }

  toState(): PartnerStaffState {
    return { ...this.state };
  }
}

/**
 * Nhân viên chỉ thao tác được (đăng nhập, dùng token) khi tài khoản còn hoạt động **và** quán của họ còn `active`
 * (AC1 BE-S4-06).
 */
export function ensurePartnerStaffCanOperate(
  staff: PartnerStaff,
  partner: Partner,
): Result<void, DomainError<'PARTNER_INACTIVE'>> {
  if (staff.partnerId !== partner.id)
    throw new Error('ensurePartnerStaffCanOperate: quán không khớp nhân viên');
  return staff.active && partner.active ? ok() : fail('PARTNER_INACTIVE');
}
