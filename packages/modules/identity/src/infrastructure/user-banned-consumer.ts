import { USER_BANNED } from '@tamgiao/contracts';
import type { EventBus } from '@tamgiao/db';
import type { DomainEvent } from '@tamgiao/kernel';
import type { BlockBannedUser } from '../application/use-cases/block-banned-user.js';

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const IDENTITY_BLOCK_ON_USER_BANNED_CONSUMER = 'identity.block-on-user-banned';

/** Lấy `userId` từ payload `UserBanned` (module safety); sai dạng là lỗi lập trình. */
function userIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.length > 0) return userId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
}

/** Đăng ký consumer `UserBanned` → thu hồi phiên + chặn đăng nhập (BE-S6-06). Chạy trong tx của `deliverOnce`. */
export function registerUserBannedConsumer(bus: EventBus, blockBannedUser: BlockBannedUser): void {
  bus.on(USER_BANNED, IDENTITY_BLOCK_ON_USER_BANNED_CONSUMER, async (event, tx) => {
    await blockBannedUser.handle(tx, { userId: userIdOf(event) });
  });
}
