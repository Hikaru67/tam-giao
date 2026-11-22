import { ACCOUNT_DELETION_REQUESTED } from '@tamgiao/contracts';
import { asDbTx, type EventBus } from '@tamgiao/db';
import type { Clock, DomainEvent } from '@tamgiao/kernel';
import { and, eq } from 'drizzle-orm';
import { deliveries, devices, preferences } from './schema.js';

/**
 * Quyền dữ liệu cá nhân của module notification (BE-S7-06): consumer khi người dùng xoá tài khoản.
 *
 * `AccountDeletionRequested` → trong cùng transaction:
 * (a) Xoá mọi dòng `devices` của `userId` (token push — dữ liệu định danh thiết bị cá nhân);
 * (b) Xoá dòng `preferences` của `userId` (cài đặt nhận thông báo cá nhân);
 * (c) Cập nhật `deliveries` set `status = 'CANCELLED'`, `updatedAt = deps.clock.now()` với các dòng có `userId`
 *     và `status = 'PENDING'` (huỷ các thông báo đang chờ gửi đến người dùng này).
 *
 * Không xoá các bản ghi `deliveries` khác (chỉ chứa id/deep link, không chứa PII và cần lưu vết đối soát).
 * Không có nguồn dữ liệu xuất (`PersonalDataSource`) vì notification không lưu trữ dữ liệu người dùng cần tải về.
 * Idempotent (A9): chạy lại không còn gì để xoá (thiết bị, cài đặt đã xoá) hoặc để huỷ (`deliveries` đã là CANCELLED).
 */

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const NOTIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER = 'notification.erase-on-account-deletion';

function userIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.length > 0) return userId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
}

/**
 * Đăng ký consumer xử lý sự kiện `AccountDeletionRequested` cho module notification.
 * Xoá token thiết bị push, cài đặt nhận thông báo và huỷ các thông báo đang chờ gửi (status = 'PENDING').
 */
export function registerNotificationAccountDeletionConsumer(
  bus: EventBus,
  deps: { readonly clock: Clock },
): void {
  bus.on(ACCOUNT_DELETION_REQUESTED, NOTIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER, async (event, tx) => {
    const userId = userIdOf(event);
    const db = asDbTx(tx);
    await db.delete(devices).where(eq(devices.userId, userId));
    await db.delete(preferences).where(eq(preferences.userId, userId));
    await db
      .update(deliveries)
      .set({ status: 'CANCELLED', updatedAt: deps.clock.now() })
      .where(and(eq(deliveries.userId, userId), eq(deliveries.status, 'PENDING')));
  });
}
