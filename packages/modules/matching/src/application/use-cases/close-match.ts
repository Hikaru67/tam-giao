import { parseId, type Clock, type Tx } from '@tamgiao/kernel';
import type { MatchCloseOutcome, MatchStatus } from '../../domain/match.js';
import type { MatchRepository } from '../ports/match-repository.js';
import {
  applyMatchTransitionEffects,
  type MatchTransitionEffectsDeps,
} from '../responses/match-transition-effects.js';

export interface CloseMatchDeps extends MatchTransitionEffectsDeps {
  readonly clock: Clock;
  readonly matches: MatchRepository;
}

export interface CloseMatchCommand {
  readonly matchId: string;
  /** Quyết định của cặp sau buổi gặp: cả hai A → `SUCCESS`; có B → `STOPPED`. */
  readonly outcome: MatchCloseOutcome;
}

/**
 * Kết quả một lần chạy (để log, không phải lỗi):
 * - `CLOSED`: match `DATING | MET` → `CLOSED_SUCCESS | CLOSED_STOPPED`.
 * - `ALREADY_CLOSED`: match đã đóng (event giao lại, hoặc đã hết hạn / bị khoá trước) → no-op.
 * - `NOT_DATING`: match còn ở `OFFERED | AWAITING_RESPONSE` (chưa thể có buổi gặp — dữ liệu lệch) → no-op.
 * - `NOT_FOUND`: không có match → no-op.
 */
export type CloseMatchOutcome =
  | { readonly kind: 'CLOSED'; readonly fromStatus: MatchStatus; readonly status: MatchStatus }
  | { readonly kind: 'ALREADY_CLOSED'; readonly status: MatchStatus }
  | { readonly kind: 'NOT_DATING'; readonly status: MatchStatus }
  | { readonly kind: 'NOT_FOUND' };

/**
 * Đóng match theo đánh giá sau gặp (BE-S7-03) — consumer `matching.close-on-feedback-submitted` gọi trong transaction
 * của `deliverOnce`. Idempotent (A9): tải lại match `FOR UPDATE` (tuần tự hoá với job hết hạn / khoá đồng thời), match
 * đã đóng → no-op.
 *
 * - `MET` → `close(outcome)`.
 * - `DATING` → `markMet` rồi `close(outcome)`: đánh giá chỉ gửi được khi lịch hẹn đã tới giờ (dating kiểm tra), tức
 *   buổi gặp đã diễn ra dù `DatePlan COMPLETED → markMet` (BE-S7-04) chưa kịp chạy. Hai event `MatchMet`, `MatchClosed`.
 *
 * Sau đó `save` + `applyMatchTransitionEffects` cùng `tx`: vào trạng thái đóng → trả active slot hai người + ghi
 * `pair_history`; `CLOSED_STOPPED` → cooldown `COOLDOWN_DAYS` cho **cả hai**; `CLOSED_SUCCESS` → không cooldown.
 * Hội thoại được messaging đóng khi nhận `MatchClosed`. `matchId` sai dạng là lỗi lập trình → throw.
 */
export class CloseMatch {
  constructor(private readonly deps: CloseMatchDeps) {}

  async executeIn(tx: Tx, cmd: CloseMatchCommand): Promise<CloseMatchOutcome> {
    const id = parseId<'Match'>(cmd.matchId);
    if (id.isErr()) throw new Error('matching.close-match: matchId không hợp lệ');

    const match = await this.deps.matches.findByIdForUpdate(tx, id.value);
    if (match === null) return { kind: 'NOT_FOUND' };

    const fromStatus = match.status;
    if (!match.isOpen()) return { kind: 'ALREADY_CLOSED', status: fromStatus };
    if (fromStatus !== 'DATING' && fromStatus !== 'MET') return { kind: 'NOT_DATING', status: fromStatus };

    const now = this.deps.clock.now();
    if (fromStatus === 'DATING') {
      const met = match.markMet(now);
      if (met.isErr()) throw new Error(`matching.close-match ${match.id}: markMet thất bại ở DATING`);
    }
    const closed = match.close(cmd.outcome, now);
    if (closed.isErr()) throw new Error(`matching.close-match ${match.id}: close thất bại ở MET`);

    await this.deps.matches.save(tx, match);
    await applyMatchTransitionEffects(this.deps, tx, match, fromStatus, now);
    return { kind: 'CLOSED', fromStatus, status: match.status };
  }
}
