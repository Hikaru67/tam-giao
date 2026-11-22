import { DATE_CONFIRMED } from '@tamgiao/contracts';
import type { EventBus } from '@tamgiao/db';
import type { DomainEvent } from '@tamgiao/kernel';
import type { ActivateVoucherOnDateConfirmed } from '../application/voucher/activate-voucher-on-date-confirmed.js';

/** Tên consumer (duy nhất toàn hệ thống, `<module>.<việc>`) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const ACTIVATE_VOUCHER_ON_DATE_CONFIRMED_CONSUMER = 'billing.activate-voucher-on-date-confirmed';

/** Lấy `inviterId` từ payload `DateConfirmedPayload`; sai dạng là lỗi lập trình → throw. */
function inviterIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const inviterId = (payload as { inviterId?: unknown }).inviterId;
    if (typeof inviterId === 'string' && inviterId.length > 0) return inviterId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu inviterId`);
}

/**
 * Đăng ký consumer `DateConfirmed` (dating, BE-S7-01) → kích hoạt voucher của người mời. Handler chạy trong transaction
 * của `deliverOnce` (cùng `processed_events`). Use case trả `Err` (voucher chưa có hạn dùng…) → throw để rollback; hàng
 * đợi thử lại rồi chuyển dead-letter (có log error) cho vận hành.
 */
export function registerDateConfirmedConsumer(bus: EventBus, activate: ActivateVoucherOnDateConfirmed): void {
  bus.on(DATE_CONFIRMED, ACTIVATE_VOUCHER_ON_DATE_CONFIRMED_CONSUMER, async (event, tx) => {
    const r = await activate.handle(tx, { userId: inviterIdOf(event) });
    if (r.isErr()) {
      throw new Error(`${ACTIVATE_VOUCHER_ON_DATE_CONFIRMED_CONSUMER} ${event.eventId}: ${r.error.code}`);
    }
  });
}
