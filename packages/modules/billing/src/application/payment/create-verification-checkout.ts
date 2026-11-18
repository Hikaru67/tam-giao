import {
  err,
  fail,
  newId,
  ok,
  type Clock,
  type DomainError,
  type Money,
  type Result,
  type Tx,
  type UnitOfWork,
} from '@tamgiao/kernel';
import {
  VerificationPayment,
  type PaymentStatus,
  type VerificationPaymentId,
} from '../../domain/verification-payment.js';
import { PaymentGatewayError, type CheckoutSession, type PaymentGateway } from '../ports/payment-gateway.js';
import type { StoredPayment, VerificationPaymentRepository } from '../ports/payment-repositories.js';

export interface CreateVerificationCheckoutCommand {
  readonly userId: string;
  /** Khoá idempotency client gửi (giữ nguyên khi thử lại cùng một thao tác). */
  readonly idempotencyKey: string;
}

export interface CheckoutView {
  readonly paymentId: VerificationPaymentId;
  readonly orderId: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly checkout: CheckoutSession;
  readonly createdAt: Date;
  /** `true` khi lần gọi này tạo khoản mới (201); `false` khi trả lại khoản đã có (200). */
  readonly created: boolean;
}

export interface CreateVerificationCheckoutDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly payments: VerificationPaymentRepository;
  readonly gateway: PaymentGateway;
  /** URL cổng chuyển người dùng về sau khi thanh toán (deep link / trang web của app). */
  readonly returnUrl: string;
}

/** Trạng thái chặn tạo khoản mới: đã thanh toán, đang hoặc đã hoàn tiền (hoàn tiền chỉ xảy ra khi hồ sơ bị từ chối). */
const BLOCKING: readonly PaymentStatus[] = ['SUCCEEDED', 'REFUND_PENDING', 'REFUNDED'];

/** Mã nội bộ: insert vi phạm unique → rollback rồi đọc lại (không bao giờ trả ra ngoài). */
const INSERT_CONFLICT = 'PAYMENT_INSERT_CONFLICT';

/**
 * Tạo (hoặc trả lại) phiên thanh toán xác thực `DEPOSIT_VND` (BE-S4-03):
 * 1. Transaction ngắn: cùng idempotency key → trả lại đúng khoản cũ; đã thanh toán / đang-đã hoàn tiền →
 *    `PAYMENT_ALREADY_EXISTS`; đang có khoản `PENDING` (key khác) → trả lại khoản đó (không tạo đơn thứ hai);
 *    còn lại → thêm khoản `PENDING`. Hai request đồng thời: partial unique index bảo đảm chỉ 1 khoản, request thua
 *    nhận 23505 → rollback → đọc lại và trả kết quả idempotent.
 * 2. Gọi cổng `createCheckout` **ngoài transaction** (không giữ connection/khoá khi chờ mạng).
 * 3. Transaction ngắn: lưu phiên nếu khoản chưa có phiên (request đồng thời cùng khoản → giữ phiên ghi trước).
 * Cổng lỗi → `PAYMENT_GATEWAY_UNAVAILABLE`; khoản vẫn `PENDING` không phiên, lần gọi sau tạo lại phiên cho đúng đơn đó.
 */
export class CreateVerificationCheckout {
  constructor(private readonly deps: CreateVerificationCheckoutDeps) {}

  async execute(cmd: CreateVerificationCheckoutCommand): Promise<Result<CheckoutView, DomainError>> {
    let resolved = await this.deps.uow.run((tx) => this.resolve(tx, cmd));
    if (resolved.isErr() && resolved.error.code === INSERT_CONFLICT) {
      // Request đồng thời vừa commit khoản của nó → đọc lại trong transaction mới.
      resolved = await this.deps.uow.run((tx) => this.resolve(tx, cmd));
      if (resolved.isErr() && resolved.error.code === INSERT_CONFLICT) {
        return fail('PAYMENT_ALREADY_EXISTS');
      }
    }
    if (resolved.isErr()) return err(resolved.error);
    const { stored, created } = resolved.value;
    const { payment } = stored;

    let checkout = stored.checkout;
    if (checkout === null) {
      if (payment.status !== 'PENDING') {
        return fail('PAYMENT_INVALID_TRANSITION', { action: 'createCheckout', status: payment.status });
      }
      let session: CheckoutSession;
      try {
        session = await this.deps.gateway.createCheckout(
          payment.orderId,
          payment.amount.amount,
          this.deps.returnUrl,
        );
      } catch (e) {
        if (e instanceof PaymentGatewayError) return fail('PAYMENT_GATEWAY_UNAVAILABLE', { kind: e.kind });
        throw e;
      }
      const attached = await this.deps.uow.run(async (tx) =>
        ok(await this.deps.payments.attachCheckout(tx, payment.id, session)),
      );
      checkout = attached.unwrapOr(session);
    }

    const s = payment.toState();
    return ok({
      paymentId: s.id,
      orderId: s.orderId,
      status: s.status,
      amount: s.amount,
      checkout,
      createdAt: s.createdAt,
      created,
    });
  }

  private async resolve(
    tx: Tx,
    cmd: CreateVerificationCheckoutCommand,
  ): Promise<Result<{ readonly stored: StoredPayment; readonly created: boolean }, DomainError>> {
    const { payments, clock } = this.deps;
    const sameKey = await payments.findByUserAndIdempotencyKey(tx, cmd.userId, cmd.idempotencyKey);
    if (sameKey !== null) return ok({ stored: sameKey, created: false });

    const existing = await payments.listByUser(tx, cmd.userId);
    const blocking = existing.find((p) => BLOCKING.includes(p.payment.status));
    if (blocking !== undefined) return fail('PAYMENT_ALREADY_EXISTS', { status: blocking.payment.status });
    const pending = existing.find((p) => p.payment.status === 'PENDING');
    if (pending !== undefined) return ok({ stored: pending, created: false });

    const id = newId<'VerificationPayment'>();
    const payment = VerificationPayment.create(
      { id, orderId: orderIdFor(id), userId: cmd.userId, idempotencyKey: cmd.idempotencyKey },
      clock.now(),
    );
    if ((await payments.insert(tx, payment)) === 'conflict') return fail(INSERT_CONFLICT);
    return ok({ stored: { payment, checkout: null }, created: true });
  }
}

/** Mã đơn gửi cổng: tiền tố + id khoản (UUID v7, bỏ gạch) — duy nhất, không chứa thông tin người dùng. */
export const orderIdFor = (id: VerificationPaymentId): string => `VP${id.replaceAll('-', '').toUpperCase()}`;
