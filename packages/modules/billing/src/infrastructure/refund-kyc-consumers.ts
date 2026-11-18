import { KYC_APPROVED, KYC_REJECTED } from '@tamgiao/contracts';
import type { EventBus } from '@tamgiao/db';
import type { DomainEvent } from '@tamgiao/kernel';
import type { SetVoucherExpiryOnKycApproved } from '../application/kyc-approved/set-voucher-expiry-on-kyc-approved.js';
import type { RefundOnKycRejected } from '../application/refund/refund-on-kyc-rejected.js';

/** Tên consumer (duy nhất toàn hệ thống, `<module>.<việc>`) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const REFUND_ON_KYC_REJECTED_CONSUMER = 'billing.refund-on-kyc-rejected';
export const SET_VOUCHER_EXPIRY_CONSUMER = 'billing.set-voucher-expiry';

/** Lấy `userId` từ payload event verification (`KycRejectedPayload` / `KycApprovedPayload`); sai dạng là lỗi lập trình. */
function userIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.length > 0) return userId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
}

export interface BillingKycConsumers {
  readonly refundOnKycRejected: RefundOnKycRejected;
  readonly setVoucherExpiry: SetVoucherExpiryOnKycApproved;
}

/**
 * Đăng ký consumer event verification của billing lên `bus` (worker gọi trước `registerConsumers`).
 * Handler chạy trong transaction của `deliverOnce` (cùng `processed_events`). Use case trả `Err` (trạng thái bất
 * thường, vd voucher đã đổi mà hồ sơ bị từ chối) → throw để rollback; hàng đợi thử lại rồi chuyển dead-letter
 * (có log error) cho vận hành.
 */
export function registerBillingKycConsumers(bus: EventBus, consumers: BillingKycConsumers): void {
  bus.on(KYC_REJECTED, REFUND_ON_KYC_REJECTED_CONSUMER, async (event, tx) => {
    const r = await consumers.refundOnKycRejected.handle(tx, { userId: userIdOf(event) });
    if (r.isErr()) throw new Error(`${REFUND_ON_KYC_REJECTED_CONSUMER} ${event.eventId}: ${r.error.code}`);
  });
  bus.on(KYC_APPROVED, SET_VOUCHER_EXPIRY_CONSUMER, async (event, tx) => {
    const r = await consumers.setVoucherExpiry.handle(tx, {
      userId: userIdOf(event),
      approvedAt: event.occurredAt,
    });
    if (r.isErr()) throw new Error(`${SET_VOUCHER_EXPIRY_CONSUMER} ${event.eventId}: ${r.error.code}`);
  });
}
