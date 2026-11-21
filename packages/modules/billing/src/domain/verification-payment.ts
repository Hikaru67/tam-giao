import { DEPOSIT_VND } from '@tamgiao/contracts/constants';
import { AggregateRoot, Money, fail, ok, type DomainError, type Id, type Result } from '@tamgiao/kernel';
import { toVndNumber } from './money-payload.js';

export type VerificationPaymentId = Id<'VerificationPayment'>;
/** Id tài khoản app (module identity) — billing chỉ giữ tham chiếu (A3). */
export type BillingUserId = string;

/**
 * Vòng đời khoản thanh toán xác thực:
 * `PENDING → SUCCEEDED | FAILED`, `SUCCEEDED → REFUND_PENDING → REFUNDED`.
 * `FAILED`, `REFUNDED` là trạng thái cuối.
 */
export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUND_PENDING', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_SUCCEEDED = 'PaymentSucceeded';
export const PAYMENT_FAILED = 'PaymentFailed';
export const REFUND_COMPLETED = 'RefundCompleted';

export type PaymentTransitionError = DomainError<'PAYMENT_INVALID_TRANSITION'>;
export type PaymentRefundError = DomainError<
  'PAYMENT_INVALID_TRANSITION' | 'PAYMENT_NOT_REFUNDABLE' | 'PAYMENT_ALREADY_REFUNDED'
>;

/** Snapshot đầy đủ để repository lưu / dựng lại aggregate (`toState` ↔ `restore`). */
export interface VerificationPaymentState {
  readonly id: VerificationPaymentId;
  /** Mã đơn gửi sang cổng thanh toán (duy nhất). */
  readonly orderId: string;
  readonly userId: BillingUserId;
  readonly amount: Money;
  readonly status: PaymentStatus;
  /** Mã giao dịch phía cổng — gán khi `SUCCEEDED`; `null` khi còn `PENDING` hoặc `FAILED`. */
  readonly gatewayTxnId: string | null;
  /** Khoá idempotency client gửi khi tạo checkout. */
  readonly idempotencyKey: string;
  /** Mã phân loại lỗi do cổng trả (không chứa PII) — chỉ khi `FAILED`. */
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly succeededAt: Date | null;
  readonly failedAt: Date | null;
  readonly refundRequestedAt: Date | null;
  readonly refundedAt: Date | null;
  readonly updatedAt: Date;
  readonly version: number;
}

const REFUND_STATUSES: readonly PaymentStatus[] = ['REFUND_PENDING', 'REFUNDED'];

/**
 * Khoản thanh toán xác thực hồ sơ (`DEPOSIT_VND`). Tên trung tính theo D1.
 * Chỉ chuyển trạng thái có event mới tăng `version`; `requestRefund` không phát event nên chỉ đổi `updatedAt`.
 */
export class VerificationPayment extends AggregateRoot<VerificationPaymentId> {
  protected readonly aggregateType = 'VerificationPayment';

  private constructor(
    private state: Omit<VerificationPaymentState, 'version'>,
    version: number,
  ) {
    super(state.id, version);
  }

  /** Tạo khoản thanh toán `PENDING` với số tiền `DEPOSIT_VND`. Không phát event. */
  static create(
    input: {
      readonly id: VerificationPaymentId;
      readonly orderId: string;
      readonly userId: BillingUserId;
      readonly idempotencyKey: string;
    },
    now: Date,
  ): VerificationPayment {
    return new VerificationPayment(
      {
        id: input.id,
        orderId: input.orderId,
        userId: input.userId,
        amount: Money.ofTrusted(DEPOSIT_VND),
        status: 'PENDING',
        gatewayTxnId: null,
        idempotencyKey: input.idempotencyKey,
        failureReason: null,
        createdAt: now,
        succeededAt: null,
        failedAt: null,
        refundRequestedAt: null,
        refundedAt: null,
        updatedAt: now,
      },
      0,
    );
  }

  static restore(state: VerificationPaymentState): VerificationPayment {
    const { version, ...rest } = state;
    return new VerificationPayment({ ...rest }, version);
  }

  get userId(): BillingUserId {
    return this.state.userId;
  }

  get orderId(): string {
    return this.state.orderId;
  }

  get amount(): Money {
    return this.state.amount;
  }

  get status(): PaymentStatus {
    return this.state.status;
  }

  get gatewayTxnId(): string | null {
    return this.state.gatewayTxnId;
  }

  get idempotencyKey(): string {
    return this.state.idempotencyKey;
  }

  /** Cổng xác nhận thanh toán thành công: `PENDING → SUCCEEDED`, gán `gatewayTxnId`, phát `PaymentSucceeded`. */
  markSucceeded(gatewayTxnId: string, now: Date): Result<void, PaymentTransitionError> {
    const guard = this.ensureStatus('markSucceeded', ['PENDING']);
    if (guard.isErr()) return guard;
    this.state = { ...this.state, status: 'SUCCEEDED', gatewayTxnId, succeededAt: now, updatedAt: now };
    this.record(
      PAYMENT_SUCCEEDED,
      {
        paymentId: this.id,
        orderId: this.state.orderId,
        userId: this.state.userId,
        amountVnd: toVndNumber(this.state.amount),
        gatewayTxnId,
      },
      now,
    );
    return ok();
  }

  /** Cổng báo thất bại / huỷ: `PENDING → FAILED`, phát `PaymentFailed`. `reason` là mã phân loại, không PII. */
  markFailed(reason: string | null, now: Date): Result<void, PaymentTransitionError> {
    const guard = this.ensureStatus('markFailed', ['PENDING']);
    if (guard.isErr()) return guard;
    this.state = { ...this.state, status: 'FAILED', failureReason: reason, failedAt: now, updatedAt: now };
    this.record(
      PAYMENT_FAILED,
      { paymentId: this.id, orderId: this.state.orderId, userId: this.state.userId, reason },
      now,
    );
    return ok();
  }

  /**
   * Bắt đầu hoàn tiền: `SUCCEEDED → REFUND_PENDING` (trước khi gọi cổng). Không phát event.
   * Chưa `SUCCEEDED` → `PAYMENT_NOT_REFUNDABLE`; đã/đang hoàn → `PAYMENT_ALREADY_REFUNDED`.
   */
  requestRefund(now: Date): Result<void, PaymentRefundError> {
    if (REFUND_STATUSES.includes(this.state.status)) {
      return fail('PAYMENT_ALREADY_REFUNDED', { status: this.state.status });
    }
    if (this.state.status !== 'SUCCEEDED') {
      return fail('PAYMENT_NOT_REFUNDABLE', { status: this.state.status });
    }
    this.state = { ...this.state, status: 'REFUND_PENDING', refundRequestedAt: now, updatedAt: now };
    return ok();
  }

  /** Cổng xác nhận đã hoàn: `REFUND_PENDING → REFUNDED`, phát `RefundCompleted`. */
  completeRefund(now: Date): Result<void, PaymentRefundError> {
    switch (this.state.status) {
      case 'REFUNDED':
        return fail('PAYMENT_ALREADY_REFUNDED', { status: this.state.status });
      case 'PENDING':
      case 'FAILED':
        return fail('PAYMENT_NOT_REFUNDABLE', { status: this.state.status });
      case 'SUCCEEDED':
        // Phải `requestRefund` trước để có trạng thái trung gian khi gọi cổng (retry an toàn).
        return fail('PAYMENT_INVALID_TRANSITION', { action: 'completeRefund', status: this.state.status });
      case 'REFUND_PENDING':
        break;
    }
    this.state = { ...this.state, status: 'REFUNDED', refundedAt: now, updatedAt: now };
    this.record(
      REFUND_COMPLETED,
      {
        paymentId: this.id,
        orderId: this.state.orderId,
        userId: this.state.userId,
        amountVnd: toVndNumber(this.state.amount),
      },
      now,
    );
    return ok();
  }

  toState(): VerificationPaymentState {
    return { ...this.state, version: this.version };
  }

  private ensureStatus(
    action: string,
    allowed: readonly PaymentStatus[],
  ): Result<void, PaymentTransitionError> {
    if (!allowed.includes(this.state.status)) {
      return fail('PAYMENT_INVALID_TRANSITION', { action, status: this.state.status });
    }
    return ok();
  }
}
