import type { EventBus } from '@tamgiao/db';
import type { DomainEvent } from '@tamgiao/kernel';
import type { MarkMatchMet } from '../application/responses/mark-match-met.js';

/**
 * Event "buổi hẹn đã diễn ra" của module dating (`DatePlan → COMPLETED`). Dating chưa phát event này (BE-S7-02/03 làm
 * song song) nên khai báo theo **tên event trong outbox**, không import code dating (A3). Payload giả định giống các
 * event `DatePlan` hiện có: `{datePlanId, matchId, inviterId, inviteeId, …}` — matching chỉ cần `matchId`.
 */
export const DATE_COMPLETED_EVENT = 'DateCompleted';

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const MATCH_MET_ON_DATE_COMPLETED_CONSUMER = 'matching.mark-met-on-date-completed';

/** Lấy `matchId` từ payload `DateCompleted`; sai dạng là lỗi lập trình của bên phát (retry → dead-letter). */
function matchIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const matchId = (payload as { matchId?: unknown }).matchId;
    if (typeof matchId === 'string' && matchId.length > 0) return matchId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu matchId`);
}

/**
 * Đăng ký consumer `DateCompleted` → `MarkMatchMet` (BE-S7-04). Chạy trong transaction của `deliverOnce` (cùng
 * `processed_events`); `MarkMatchMet` tự idempotent (match không còn `DATING` → no-op).
 */
export function registerDateCompletedConsumer(bus: EventBus, markMatchMet: MarkMatchMet): void {
  bus.on(DATE_COMPLETED_EVENT, MATCH_MET_ON_DATE_COMPLETED_CONSUMER, async (event, tx) => {
    await markMatchMet.executeIn(tx, { matchId: matchIdOf(event) });
  });
}
