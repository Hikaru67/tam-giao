import { VOUCHER_TTL_DAYS, VOUCHER_VND } from '@tamgiao/contracts/constants';
import {
  AggregateRoot,
  Money,
  addDuration,
  fail,
  ok,
  type DomainError,
  type Id,
  type Result,
} from '@tamgiao/kernel';
import { toVndNumber } from './money-payload.js';
import type { BillingUserId, VerificationPaymentId } from './verification-payment.js';

export type VoucherId = Id<'Voucher'>;
/** Id quán đối tác (aggregate partner của BE-S4-06) — chỉ giữ tham chiếu. */
export type VoucherPartnerId = string;

/**
 * Vòng đời voucher hẹn hò:
 * `RESERVED → ACTIVE → REDEEMED`; `RESERVED | ACTIVE → VOID | EXPIRED`.
 * `REDEEMED`, `VOID`, `EXPIRED` là trạng thái cuối — không chuyển tiếp được nữa.
 */
export const VOUCHER_STATUSES = ['RESERVED', 'ACTIVE', 'REDEEMED', 'VOID', 'EXPIRED'] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

export const VOUCHER_ISSUED = 'VoucherIssued';
export const VOUCHER_ACTIVATED = 'VoucherActivated';
export const VOUCHER_REDEEMED = 'VoucherRedeemed';
export const VOUCHER_VOIDED = 'VoucherVoided';
export const VOUCHER_EXPIRED_EVENT = 'VoucherExpired';

/** Lỗi khi thao tác trên voucher ở trạng thái cuối hoặc trạng thái không cho phép. */
export type VoucherTransitionError = DomainError<
  'VOUCHER_INVALID_TRANSITION' | 'VOUCHER_NOT_ACTIVE' | 'VOUCHER_ALREADY_REDEEMED' | 'VOUCHER_EXPIRED'
>;
export type VoucherRedeemError = VoucherTransitionError | DomainError<'VOUCHER_PARTNER_MISMATCH'>;

/** Snapshot đầy đủ để repository lưu / dựng lại aggregate (`toState` ↔ `restore`). */
export interface VoucherState {
  readonly id: VoucherId;
  readonly userId: BillingUserId;
  /** Khoản thanh toán xác thực sinh ra voucher. */
  readonly paymentId: VerificationPaymentId;
  readonly value: Money;
  readonly status: VoucherStatus;
  /** Quán đối tác được gắn (nếu có) — khi gắn, chỉ quán này được đổi voucher. */
  readonly partnerId: VoucherPartnerId | null;
  /**
   * Hạn dùng = ngày hồ sơ được duyệt + `VOUCHER_TTL_DAYS`. `null` khi hồ sơ chưa được duyệt
   * (voucher `RESERVED` được tạo ngay khi thanh toán thành công, trước khi biết ngày duyệt).
   */
  readonly expiresAt: Date | null;
  readonly issuedAt: Date;
  readonly activatedAt: Date | null;
  readonly redeemedAt: Date | null;
  /** Quán thực tế đã đổi voucher. */
  readonly redeemedByPartnerId: VoucherPartnerId | null;
  readonly voidedAt: Date | null;
  /** Mã lý do huỷ (vd `PAYMENT_REFUNDED`) — không chứa PII. */
  readonly voidReason: string | null;
  readonly expiredAt: Date | null;
  readonly updatedAt: Date;
  readonly version: number;
}

const OPEN_STATUSES: readonly VoucherStatus[] = ['RESERVED', 'ACTIVE'];

/** Lỗi chuẩn khi voucher đã ở trạng thái cuối, dùng chung cho mọi thao tác (AC2). */
const terminalError = (status: VoucherStatus): Result<never, VoucherTransitionError> | null => {
  switch (status) {
    case 'REDEEMED':
      return fail('VOUCHER_ALREADY_REDEEMED', { status });
    case 'EXPIRED':
      return fail('VOUCHER_EXPIRED', { status });
    case 'VOID':
      return fail('VOUCHER_NOT_ACTIVE', { status });
    case 'RESERVED':
    case 'ACTIVE':
      return null;
  }
};

/**
 * Voucher hẹn hò `VOUCHER_VND` tặng kèm khoản thanh toán xác thực. Thời hạn tính từ ngày hồ sơ được duyệt
 * (`setExpiryFromApproval`); voucher coi là hết hạn khi `now >= expiresAt`.
 * Chỉ chuyển trạng thái có event mới tăng `version`; `setExpiryFromApproval`, `assignPartner` chỉ đổi `updatedAt`.
 */
export class Voucher extends AggregateRoot<VoucherId> {
  protected readonly aggregateType = 'Voucher';

  private constructor(
    private state: Omit<VoucherState, 'version'>,
    version: number,
  ) {
    super(state.id, version);
  }

  /** Phát hành voucher `RESERVED` (khi thanh toán xác thực thành công), phát `VoucherIssued`. */
  static issue(
    input: {
      readonly id: VoucherId;
      readonly userId: BillingUserId;
      readonly paymentId: VerificationPaymentId;
      readonly partnerId?: VoucherPartnerId | null;
    },
    now: Date,
  ): Voucher {
    const voucher = new Voucher(
      {
        id: input.id,
        userId: input.userId,
        paymentId: input.paymentId,
        value: Money.ofTrusted(VOUCHER_VND),
        status: 'RESERVED',
        partnerId: input.partnerId ?? null,
        expiresAt: null,
        issuedAt: now,
        activatedAt: null,
        redeemedAt: null,
        redeemedByPartnerId: null,
        voidedAt: null,
        voidReason: null,
        expiredAt: null,
        updatedAt: now,
      },
      0,
    );
    voucher.record(
      VOUCHER_ISSUED,
      {
        voucherId: voucher.id,
        userId: input.userId,
        paymentId: input.paymentId,
        valueVnd: toVndNumber(voucher.state.value),
      },
      now,
    );
    return voucher;
  }

  static restore(state: VoucherState): Voucher {
    const { version, ...rest } = state;
    return new Voucher({ ...rest }, version);
  }

  get userId(): BillingUserId {
    return this.state.userId;
  }

  get paymentId(): VerificationPaymentId {
    return this.state.paymentId;
  }

  get value(): Money {
    return this.state.value;
  }

  get status(): VoucherStatus {
    return this.state.status;
  }

  get partnerId(): VoucherPartnerId | null {
    return this.state.partnerId;
  }

  get expiresAt(): Date | null {
    return this.state.expiresAt;
  }

  /** `true` khi đã có hạn và `now >= expiresAt` (không xét trạng thái). */
  isPastExpiry(now: Date): boolean {
    return this.state.expiresAt !== null && now.getTime() >= this.state.expiresAt.getTime();
  }

  /**
   * Đặt hạn dùng = `approvedAt` + `VOUCHER_TTL_DAYS` khi hồ sơ được duyệt. Chỉ đặt một lần, khi voucher còn
   * `RESERVED | ACTIVE`. Không phát event.
   */
  setExpiryFromApproval(approvedAt: Date, now: Date): Result<void, VoucherTransitionError> {
    const terminal = terminalError(this.state.status);
    if (terminal) return terminal;
    if (this.state.expiresAt !== null) {
      return fail('VOUCHER_INVALID_TRANSITION', {
        action: 'setExpiryFromApproval',
        status: this.state.status,
        reason: 'expiry_already_set',
      });
    }
    this.state = {
      ...this.state,
      expiresAt: addDuration(approvedAt, { days: VOUCHER_TTL_DAYS }),
      updatedAt: now,
    };
    return ok();
  }

  /**
   * Gắn voucher với một quán đối tác (khi còn `RESERVED | ACTIVE`). Gắn lại đúng quán cũ là no-op;
   * đã gắn quán khác → `VOUCHER_INVALID_TRANSITION`. Không phát event.
   */
  assignPartner(partnerId: VoucherPartnerId, now: Date): Result<void, VoucherTransitionError> {
    const terminal = terminalError(this.state.status);
    if (terminal) return terminal;
    if (this.state.partnerId === partnerId) return ok();
    if (this.state.partnerId !== null) {
      return fail('VOUCHER_INVALID_TRANSITION', {
        action: 'assignPartner',
        status: this.state.status,
        reason: 'partner_already_assigned',
      });
    }
    this.state = { ...this.state, partnerId, updatedAt: now };
    return ok();
  }

  /**
   * Kích hoạt (khi buổi hẹn được xác nhận): `RESERVED → ACTIVE`, phát `VoucherActivated`.
   * Cần đã có hạn dùng (hồ sơ đã duyệt) và chưa quá hạn.
   */
  activate(now: Date): Result<void, VoucherTransitionError> {
    const terminal = terminalError(this.state.status);
    if (terminal) return terminal;
    if (this.state.status !== 'RESERVED') {
      return fail('VOUCHER_INVALID_TRANSITION', { action: 'activate', status: this.state.status });
    }
    const { expiresAt } = this.state;
    if (expiresAt === null) {
      return fail('VOUCHER_INVALID_TRANSITION', {
        action: 'activate',
        status: this.state.status,
        reason: 'expiry_not_set',
      });
    }
    if (this.isPastExpiry(now)) return fail('VOUCHER_EXPIRED', { status: this.state.status });

    this.state = { ...this.state, status: 'ACTIVE', activatedAt: now, updatedAt: now };
    this.record(
      VOUCHER_ACTIVATED,
      { voucherId: this.id, userId: this.state.userId, expiresAt: expiresAt.toISOString() },
      now,
    );
    return ok();
  }

  /**
   * Quán đối tác đổi voucher: `ACTIVE → REDEEMED`, phát `VoucherRedeemed`.
   * Điều kiện: đang `ACTIVE`, chưa hết hạn theo `now`, và đúng quán nếu voucher đã gắn quán.
   */
  redeem(partnerId: VoucherPartnerId, now: Date): Result<void, VoucherRedeemError> {
    const terminal = terminalError(this.state.status);
    if (terminal) return terminal;
    if (this.state.status !== 'ACTIVE') return fail('VOUCHER_NOT_ACTIVE', { status: this.state.status });
    if (this.isPastExpiry(now)) return fail('VOUCHER_EXPIRED', { status: this.state.status });
    if (this.state.partnerId !== null && this.state.partnerId !== partnerId) {
      return fail('VOUCHER_PARTNER_MISMATCH');
    }

    this.state = {
      ...this.state,
      status: 'REDEEMED',
      redeemedAt: now,
      redeemedByPartnerId: partnerId,
      updatedAt: now,
    };
    this.record(
      VOUCHER_REDEEMED,
      {
        voucherId: this.id,
        userId: this.state.userId,
        partnerId,
        valueVnd: toVndNumber(this.state.value),
      },
      now,
    );
    return ok();
  }

  /** Huỷ voucher (vd hoàn tiền thanh toán): `RESERVED | ACTIVE → VOID`, phát `VoucherVoided`. */
  void(reason: string, now: Date): Result<void, VoucherTransitionError> {
    const terminal = terminalError(this.state.status);
    if (terminal) return terminal;
    this.state = { ...this.state, status: 'VOID', voidedAt: now, voidReason: reason, updatedAt: now };
    this.record(
      VOUCHER_VOIDED,
      {
        voucherId: this.id,
        userId: this.state.userId,
        paymentId: this.state.paymentId,
        reason,
        valueVnd: toVndNumber(this.state.value),
      },
      now,
    );
    return ok();
  }

  /**
   * Đánh dấu hết hạn (job định kỳ): `RESERVED | ACTIVE → EXPIRED` khi `now >= expiresAt`, phát `VoucherExpired`.
   * Chưa tới hạn (hoặc chưa có hạn) → `VOUCHER_INVALID_TRANSITION`, job bỏ qua.
   */
  expire(now: Date): Result<void, VoucherTransitionError> {
    const terminal = terminalError(this.state.status);
    if (terminal) return terminal;
    if (!this.isPastExpiry(now)) {
      return fail('VOUCHER_INVALID_TRANSITION', {
        action: 'expire',
        status: this.state.status,
        reason: 'not_expired',
      });
    }
    this.state = { ...this.state, status: 'EXPIRED', expiredAt: now, updatedAt: now };
    this.record(
      VOUCHER_EXPIRED_EVENT,
      { voucherId: this.id, userId: this.state.userId, valueVnd: toVndNumber(this.state.value) },
      now,
    );
    return ok();
  }

  toState(): VoucherState {
    return { ...this.state, version: this.version };
  }

  /** Trạng thái còn hiệu lực chuyển tiếp (`RESERVED | ACTIVE`). */
  get isOpen(): boolean {
    return OPEN_STATUSES.includes(this.state.status);
  }
}
