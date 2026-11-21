import { REPORT_FILED } from '@tamgiao/contracts';
import type { EventBus } from '@tamgiao/db';
import type { DomainEvent } from '@tamgiao/kernel';
import { MATCH_LOCK_REASON_REPORT_FILED, type LockMatch } from '../application/responses/lock-match.js';

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const MATCH_LOCK_ON_REPORT_FILED_CONSUMER = 'matching.lock-on-report-filed';

/** Lấy `matchId` từ payload `ReportFiled` (module safety); sai dạng là lỗi lập trình. */
function matchIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const matchId = (payload as { matchId?: unknown }).matchId;
    if (typeof matchId === 'string' && matchId.length > 0) return matchId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu matchId`);
}

/**
 * Đăng ký consumer `ReportFiled` → `LockMatch` (BE-S6-05). Chạy trong transaction của `deliverOnce` (cùng
 * `processed_events`); `LockMatch` tự idempotent (match đã đóng → no-op).
 */
export function registerReportFiledConsumer(bus: EventBus, lockMatch: LockMatch): void {
  bus.on(REPORT_FILED, MATCH_LOCK_ON_REPORT_FILED_CONSUMER, async (event, tx) => {
    await lockMatch.executeIn(tx, { matchId: matchIdOf(event), reason: MATCH_LOCK_REASON_REPORT_FILED });
  });
}
