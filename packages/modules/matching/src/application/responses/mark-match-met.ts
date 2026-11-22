import { parseId, type Clock, type Tx } from '@tamgiao/kernel';
import type { MatchStatus } from '../../domain/match.js';
import type { MatchRepository } from '../ports/match-repository.js';
import { applyMatchTransitionEffects, type MatchTransitionEffectsDeps } from './match-transition-effects.js';

export interface MarkMatchMetDeps extends MatchTransitionEffectsDeps {
  readonly clock: Clock;
  readonly matches: MatchRepository;
}

export interface MarkMatchMetCommand {
  readonly matchId: string;
}

/**
 * Kết quả một lần chạy (để log, không phải lỗi):
 * - `MET`: match `DATING` → `MET` (bỏ hạn `DATING_DAYS`, `MatchMet` vào outbox).
 * - `NOT_DATING`: match không còn ở `DATING` (đã `MET` — event giao lại; đã đóng vì hết hạn / dừng / khoá) → no-op.
 * - `NOT_FOUND`: không có match → no-op.
 */
export type MarkMatchMetOutcome =
  | { readonly kind: 'MET' }
  | { readonly kind: 'NOT_DATING'; readonly status: MatchStatus }
  | { readonly kind: 'NOT_FOUND' };

/**
 * Buổi hẹn đã diễn ra → match `MET` (BE-S7-04) — consumer `matching.mark-met-on-date-completed` gọi trong transaction
 * của `deliverOnce`. Idempotent (A9): tải lại match `FOR UPDATE` (tuần tự hoá với job hết hạn `DATING_DAYS` chạy cùng
 * lúc — bên nào khoá trước thắng, bên sau thấy trạng thái mới) rồi để domain `markMet()` quyết định; không ở `DATING`
 * → no-op, không event. Chuyển trạng thái → `save` + `applyMatchTransitionEffects` cùng `tx` (`MET` vẫn là trạng thái
 * mở: giữ active slot, không hẹn job; job hết hạn cũ của `DATING` chạy sau thấy `MET` → no-op).
 * `matchId` sai dạng là lỗi lập trình của bên phát → throw.
 */
export class MarkMatchMet {
  constructor(private readonly deps: MarkMatchMetDeps) {}

  async executeIn(tx: Tx, cmd: MarkMatchMetCommand): Promise<MarkMatchMetOutcome> {
    const id = parseId<'Match'>(cmd.matchId);
    if (id.isErr()) throw new Error('matching.mark-match-met: matchId không hợp lệ');

    const match = await this.deps.matches.findByIdForUpdate(tx, id.value);
    if (match === null) return { kind: 'NOT_FOUND' };

    const fromStatus = match.status;
    const now = this.deps.clock.now();
    const met = match.markMet(now);
    if (met.isErr()) return { kind: 'NOT_DATING', status: fromStatus };

    await this.deps.matches.save(tx, match);
    await applyMatchTransitionEffects(this.deps, tx, match, fromStatus, now);
    return { kind: 'MET' };
  }
}
