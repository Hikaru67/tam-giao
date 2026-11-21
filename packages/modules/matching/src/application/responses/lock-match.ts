import { parseId, type Clock, type Tx } from '@tamgiao/kernel';
import type { MatchStatus } from '../../domain/match.js';
import type { MatchRepository } from '../ports/match-repository.js';
import { applyMatchTransitionEffects, type MatchTransitionEffectsDeps } from './match-transition-effects.js';

/** Mã lý do khoá khi có báo cáo an toàn (`ReportFiled`) — lưu `matches.lock_reason`, nằm trong `MatchLocked`. */
export const MATCH_LOCK_REASON_REPORT_FILED = 'REPORT_FILED';

export interface LockMatchDeps extends MatchTransitionEffectsDeps {
  readonly clock: Clock;
  readonly matches: MatchRepository;
}

export interface LockMatchCommand {
  readonly matchId: string;
  /** Mã phân loại (không PII), vd `REPORT_FILED`. */
  readonly reason: string;
}

/**
 * Kết quả một lần chạy (để log, không phải lỗi):
 * - `LOCKED`: match đang mở → `LOCKED` (+ `MatchLocked` vào outbox, trả active slot, ghi `pair_history`).
 * - `ALREADY_CLOSED`: match đã đóng (kể cả đã `LOCKED` — event giao lại / báo cáo thứ hai) → no-op.
 * - `NOT_FOUND`: không có match → no-op.
 */
export type LockMatchOutcome =
  | { readonly kind: 'LOCKED'; readonly fromStatus: MatchStatus }
  | { readonly kind: 'ALREADY_CLOSED'; readonly status: MatchStatus }
  | { readonly kind: 'NOT_FOUND' };

/**
 * Khoá match do báo cáo vi phạm (BE-S6-05) — consumer `matching.lock-on-report-filed` gọi trong transaction của
 * `deliverOnce`. Idempotent (A9): tải lại match `FOR UPDATE` (tuần tự hoá với thao tác người dùng / job hết hạn đồng
 * thời) rồi để domain `lock()` quyết định; match đã đóng → no-op, không event. Chuyển trạng thái → `save` +
 * `applyMatchTransitionEffects` cùng `tx` (vào `LOCKED` = trạng thái đóng → trả active slot + `pair_history`).
 * Hội thoại được messaging đóng khi nhận `MatchLocked` (BE-S6-01). `matchId` sai dạng là lỗi lập trình → throw.
 */
export class LockMatch {
  constructor(private readonly deps: LockMatchDeps) {}

  async executeIn(tx: Tx, cmd: LockMatchCommand): Promise<LockMatchOutcome> {
    const id = parseId<'Match'>(cmd.matchId);
    if (id.isErr()) throw new Error('matching.lock-match: matchId không hợp lệ');

    const match = await this.deps.matches.findByIdForUpdate(tx, id.value);
    if (match === null) return { kind: 'NOT_FOUND' };

    const fromStatus = match.status;
    if (!match.isOpen()) return { kind: 'ALREADY_CLOSED', status: fromStatus };

    const now = this.deps.clock.now();
    const locked = match.lock(cmd.reason, now);
    if (locked.isErr()) return { kind: 'ALREADY_CLOSED', status: fromStatus };

    await this.deps.matches.save(tx, match);
    await applyMatchTransitionEffects(this.deps, tx, match, fromStatus, now);
    return { kind: 'LOCKED', fromStatus };
  }
}
