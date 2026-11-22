import { VOUCHER_REDEEMED } from '@tamgiao/contracts';
import type { EventBus } from '@tamgiao/db';
import type { DomainEvent } from '@tamgiao/kernel';
import type { CheckInOnVoucherRedeemed } from '../application/check-in-worker-jobs.js';

/** Tên consumer (duy nhất toàn hệ thống, `<module>.<việc>`). */
export const CHECK_IN_ON_VOUCHER_REDEEMED_CONSUMER = 'dating.check-in-on-voucher-redeemed';

function payloadOf(event: DomainEvent): { userId: string; partnerId: string } {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const { userId, partnerId } = payload as { userId?: unknown; partnerId?: unknown };
    if (
      typeof userId === 'string' &&
      userId.length > 0 &&
      typeof partnerId === 'string' &&
      partnerId.length > 0
    ) {
      return { userId, partnerId };
    }
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId hoặc partnerId`);
}

/**
 * Đăng ký consumer `VoucherRedeemed` (billing) → check-in an toàn nguồn VOUCHER cho lịch hẹn đang diễn ra (BE-S7-02).
 * Chạy trong transaction của `deliverOnce` (cùng `processed_events`).
 */
export function registerVoucherRedeemedConsumer(bus: EventBus, useCase: CheckInOnVoucherRedeemed): void {
  bus.on(VOUCHER_REDEEMED, CHECK_IN_ON_VOUCHER_REDEEMED_CONSUMER, async (event, tx) => {
    const { userId, partnerId } = payloadOf(event);
    const redeemedAt = event.occurredAt instanceof Date ? event.occurredAt : new Date(event.occurredAt);
    await useCase.handle(tx, { userId, partnerId, redeemedAt });
  });
}
