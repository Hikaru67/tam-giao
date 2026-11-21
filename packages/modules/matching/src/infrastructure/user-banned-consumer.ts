import { USER_BANNED } from '@tamgiao/contracts';
import type { EventBus } from '@tamgiao/db';
import type { DomainEvent } from '@tamgiao/kernel';
import type { SetCandidateVerification } from '../application/candidate-profile-sync.js';
import type { MatchRepository } from '../application/ports/match-repository.js';
import type { LockMatch } from '../application/responses/lock-match.js';

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const MATCH_EXCLUDE_ON_USER_BANNED_CONSUMER = 'matching.exclude-on-user-banned';

/** Mã lý do khoá match khi một bên bị khoá tài khoản — lưu `matches.lock_reason`, nằm trong `MatchLocked`. */
export const MATCH_LOCK_REASON_USER_BANNED = 'USER_BANNED';

export interface UserBannedConsumerDeps {
  readonly setVerification: SetCandidateVerification;
  readonly matches: Pick<MatchRepository, 'findOpenByUser'>;
  readonly lockMatch: LockMatch;
}

/** Lấy `userId` từ payload `UserBanned` (module safety); sai dạng là lỗi lập trình. */
function userIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.length > 0) return userId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
}

/**
 * Đăng ký consumer `UserBanned` (BE-S6-06), chạy trong transaction của `deliverOnce`:
 * 1. read model `candidate_profiles.verified = false` → `CandidateFinder` (lọc `verified`) không còn trả user này, kể cả
 *    trong danh sách của người khác (tài khoản bị khoá không đăng nhập lại để xác thực lại được);
 * 2. match đang mở của user (tối đa một — độc quyền 1-1) → `LockMatch` lý do `USER_BANNED` (tải lại `FOR UPDATE`, trả
 *    active slot + `pair_history`, `MatchLocked` vào outbox → messaging đóng hội thoại).
 * Idempotent (A9): cờ ghi đè, match đã đóng → không còn match mở / `LockMatch` no-op.
 */
export function registerUserBannedConsumer(bus: EventBus, deps: UserBannedConsumerDeps): void {
  bus.on(USER_BANNED, MATCH_EXCLUDE_ON_USER_BANNED_CONSUMER, async (event, tx) => {
    const userId = userIdOf(event);
    await deps.setVerification.handle(tx, { userId, verified: false });
    const open = await deps.matches.findOpenByUser(tx, userId);
    if (open !== null) {
      await deps.lockMatch.executeIn(tx, { matchId: open.id, reason: MATCH_LOCK_REASON_USER_BANNED });
    }
  });
}
