import { ok, type UnitOfWork } from '@tamgiao/kernel';
import type { BillingFacade } from '../facade.js';
import type { VerificationPaymentRepository } from '../ports/payment-repositories.js';
import { toPaymentView, type PaymentView } from './payment-views.js';

export interface PaymentQueryDeps {
  readonly uow: UnitOfWork;
  readonly payments: VerificationPaymentRepository;
}

/** `GET /me/payments`: lịch sử thanh toán của người dùng, mới nhất trước. */
export class GetMyPayments {
  constructor(private readonly deps: PaymentQueryDeps) {}

  async execute(userId: string): Promise<readonly PaymentView[]> {
    const rows = await this.deps.uow.run(async (tx) => ok(await this.deps.payments.listByUser(tx, userId)));
    return rows.unwrapOr([]).map(toPaymentView);
  }
}

/**
 * Hiện thực `BillingFacade` (read-only, mỗi lời gọi một transaction ngắn). "Đã thanh toán xác thực" = có khoản
 * `SUCCEEDED`. `REFUND_PENDING`/`REFUNDED` không tính: hoàn tiền chỉ xảy ra khi hồ sơ bị từ chối (hoặc admin hoàn
 * thủ công) — tiền đã/đang trả lại nên người dùng không còn quyền lợi của khoản thanh toán.
 */
export class BillingFacadeQueries implements BillingFacade {
  constructor(private readonly deps: PaymentQueryDeps) {}

  async hasPaidVerification(userId: string): Promise<boolean> {
    const rows = await this.deps.uow.run(async (tx) => ok(await this.deps.payments.listByUser(tx, userId)));
    return rows.unwrapOr([]).some((p) => p.payment.status === 'SUCCEEDED');
  }
}
