import { COOLDOWN_DAYS } from '@tamgiao/contracts/constants';
import { addDuration, type Scheduler, type Tx } from '@tamgiao/kernel';
import type { Match, MatchStatus } from '../../domain/match.js';
import { matchExpiryJob } from '../match-expiry.js';
import type { ActiveSlotRepository } from '../ports/active-slot-repository.js';
import type { CooldownRepository } from '../ports/cooldown-repository.js';
import type { PairHistoryRepository } from '../ports/pair-history-repository.js';

export interface MatchTransitionEffectsDeps {
  readonly activeSlots: ActiveSlotRepository;
  readonly pairHistory: PairHistoryRepository;
  readonly cooldowns: CooldownRepository;
  readonly scheduler: Scheduler;
}

/**
 * Hiệu ứng phụ khi match đổi trạng thái (BE-S5-05) — dùng chung cho `AcceptOffer`, `DeclineOffer`, `WithdrawIntro`,
 * `ExpireMatch`. Gọi trong cùng `tx` với `matches.save` (sau khi save thành công). Trạng thái không đổi → không làm gì.
 *
 * - Vào `AWAITING_RESPONSE` / `DATING` → hẹn job hết hạn cho hạn mới (`matchExpiryJob`, khoá `<matchId>:<version mới>`;
 *   job cũ của trạng thái trước vẫn chạy nhưng `ExpireMatch` thấy chưa tới hạn → no-op).
 * - Vào bất kỳ trạng thái đóng nào (`DECLINED`, `EXPIRED`, `CLOSED_STOPPED`, `CLOSED_SUCCESS`, `LOCKED`) → trả active
 *   slot của hai người (ARCHITECTURE mục 5: "đóng match = xoá 2 dòng") + ghi `pair_history` với outcome = trạng thái
 *   cuối (cặp không bao giờ được đề xuất lại).
 * - `CLOSED_STOPPED` (dừng tìm hiểu hoặc hết `DATING_DAYS`) → thêm cooldown cho **cả hai** người tới
 *   `now + COOLDOWN_DAYS`.
 *
 * Mọi thao tác đều idempotent (release lặp lại, record ghi đè, cooldown giữ `until` lớn hơn, job khoá theo version).
 */
export async function applyMatchTransitionEffects(
  deps: MatchTransitionEffectsDeps,
  tx: Tx,
  match: Match,
  previousStatus: MatchStatus,
  now: Date,
): Promise<void> {
  const { status } = match;
  if (status === previousStatus) return;

  if (status === 'AWAITING_RESPONSE' || status === 'DATING') {
    const job = matchExpiryJob(match);
    if (job === null) throw new Error(`match ${match.id} ở ${status} phải có hạn`);
    await deps.scheduler.schedule(tx, job);
    return;
  }

  if (match.isOpen()) return;

  const [first, second] = match.participants;
  await deps.activeSlots.release(tx, match.id);
  await deps.pairHistory.record(tx, first, second, status, match.id, now);
  if (status === 'CLOSED_STOPPED') {
    const until = addDuration(now, { days: COOLDOWN_DAYS });
    await deps.cooldowns.start(tx, first, until, now);
    await deps.cooldowns.start(tx, second, until, now);
  }
}
