import { FEEDBACK_SUBMITTED } from '@tamgiao/contracts';
import type { EventBus } from '@tamgiao/db';
import type { DomainEvent } from '@tamgiao/kernel';
import type { MatchCloseOutcome } from '../domain/match.js';
import type { CloseMatch, CloseMatchCommand } from '../application/use-cases/close-match.js';

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const MATCH_CLOSE_ON_FEEDBACK_SUBMITTED_CONSUMER = 'matching.close-on-feedback-submitted';

const OUTCOMES: readonly MatchCloseOutcome[] = ['SUCCESS', 'STOPPED'];

/** Lấy `matchId` + `outcome` từ payload `FeedbackSubmitted` (module dating); sai dạng là lỗi lập trình → throw. */
function commandOf(event: DomainEvent): CloseMatchCommand {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const { matchId, outcome } = payload as { matchId?: unknown; outcome?: unknown };
    const known = OUTCOMES.find((o) => o === outcome);
    if (typeof matchId === 'string' && matchId.length > 0 && known !== undefined) {
      return { matchId, outcome: known };
    }
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu matchId/outcome hợp lệ`);
}

/**
 * Đăng ký consumer `FeedbackSubmitted` → `CloseMatch` (BE-S7-03). Chạy trong transaction của `deliverOnce` (cùng
 * `processed_events`); `CloseMatch` tự idempotent (match đã đóng → no-op).
 */
export function registerFeedbackSubmittedConsumer(bus: EventBus, closeMatch: CloseMatch): void {
  bus.on(FEEDBACK_SUBMITTED, MATCH_CLOSE_ON_FEEDBACK_SUBMITTED_CONSUMER, async (event, tx) => {
    await closeMatch.executeIn(tx, commandOf(event));
  });
}
