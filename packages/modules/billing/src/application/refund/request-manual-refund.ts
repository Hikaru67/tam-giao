import {
  err,
  fail,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { AuditLogger } from '@tamgiao/module-identity/facade';
import type { PaymentStatus } from '../../domain/verification-payment.js';
import { startRefund, type StartRefundDeps, type StartRefundError } from './start-refund.js';

export const PAYMENT_AUDIT_TARGET_TYPE = 'payment';
export const MANUAL_REFUND_AUDIT_ACTION = 'billing.refund_request';

export interface RefundAdminActor {
  readonly adminId: string;
  readonly ip: string | null;
}

export interface RequestManualRefundCommand {
  readonly actor: RefundAdminActor;
  readonly paymentId: string;
  /** Lý do hoàn tiền (bắt buộc, đã kiểm tra độ dài ở presentation) — chỉ lưu ở audit log. */
  readonly reason: string;
}

export interface ManualRefundView {
  readonly paymentId: string;
  readonly status: PaymentStatus;
  readonly refundRequestedAt: Date;
  readonly voucherVoided: boolean;
}

export interface RequestManualRefundDeps extends StartRefundDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly auditLogger: AuditLogger;
}

export type RequestManualRefundError = StartRefundError | DomainError<'PAYMENT_NOT_FOUND'>;

/**
 * Admin hoàn tiền thủ công (permission `billing:refund`, BE-S4-04). Dùng chung luồng với consumer `KycRejected`:
 * một transaction khoá payment (`FOR UPDATE`) → `SUCCEEDED → REFUND_PENDING` + huỷ voucher + ledger `VOUCHER_VOID` →
 * audit `billing.refund_request` (meta: lý do) cùng `tx`. Job quét `REFUND_PENDING` gọi cổng sau.
 * Đang/đã hoàn → `PAYMENT_ALREADY_REFUNDED`; chưa thanh toán thành công → `PAYMENT_NOT_REFUNDABLE`.
 */
export class RequestManualRefund {
  constructor(private readonly deps: RequestManualRefundDeps) {}

  async execute(
    cmd: RequestManualRefundCommand,
  ): Promise<Result<ManualRefundView, RequestManualRefundError>> {
    const parsed = parseId<'VerificationPayment'>(cmd.paymentId);
    if (parsed.isErr()) return fail('PAYMENT_NOT_FOUND');
    const paymentId = parsed.value;

    return this.deps.uow.run(async (tx) => {
      const payment = await this.deps.payments.findByIdForUpdate(tx, paymentId);
      if (payment === null) return fail('PAYMENT_NOT_FOUND');
      const previousStatus = payment.status;
      const now = this.deps.clock.now();
      const started = await startRefund(this.deps, tx, payment, now);
      if (started.isErr()) return err(started.error);

      const audited = await this.deps.auditLogger.log(tx, {
        actor: { type: 'admin', id: cmd.actor.adminId },
        action: MANUAL_REFUND_AUDIT_ACTION,
        targetType: PAYMENT_AUDIT_TARGET_TYPE,
        targetId: payment.id,
        ip: cmd.actor.ip,
        meta: { reason: cmd.reason, previousStatus, voucherVoided: started.value.voucherVoided },
      });
      // Audit bị từ chối là lỗi lập trình → throw để rollback cả thao tác (không hoàn tiền mà thiếu vết).
      if (audited.isErr())
        throw new Error(`audit log ${MANUAL_REFUND_AUDIT_ACTION} rejected: ${audited.error.code}`);

      return ok({
        paymentId: payment.id,
        status: payment.status,
        refundRequestedAt: now,
        voucherVoided: started.value.voucherVoided,
      });
    });
  }
}
