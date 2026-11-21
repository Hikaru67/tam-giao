import { ok, parseId, type Clock, type Tx, type UnitOfWork } from '@tamgiao/kernel';
import type { MatchStatus } from '../../domain/match.js';
import type { MatchExpiryPayload } from '../match-expiry.js';
import type { MatchRepository } from '../ports/match-repository.js';
import { applyMatchTransitionEffects, type MatchTransitionEffectsDeps } from './match-transition-effects.js';

export interface ExpireMatchDeps extends MatchTransitionEffectsDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly matches: MatchRepository;
}

/**
 * Kết quả một lần chạy job (để log, không phải lỗi):
 * - `EXPIRED`: `OFFERED`/`AWAITING_RESPONSE` quá hạn → `EXPIRED`.
 * - `CLOSED_STOPPED`: `DATING` hết `DATING_DAYS` → `CLOSED_STOPPED` (+ cooldown hai người).
 * - `NOT_YET_EXPIRED`: job cũ của trạng thái trước (match đã có hạn mới) → no-op.
 * - `ALREADY_CLOSED`: match đã đóng hoặc ở `MET` (không có hạn) → no-op (job chạy lại / job cũ).
 * - `NOT_FOUND`: không có match (không thể xảy ra nếu job được hẹn cùng transaction) → no-op.
 */
export type ExpireMatchOutcome =
  | { readonly kind: 'EXPIRED' | 'CLOSED_STOPPED'; readonly fromStatus: MatchStatus }
  | { readonly kind: 'NOT_YET_EXPIRED' | 'ALREADY_CLOSED'; readonly status: MatchStatus }
  | { readonly kind: 'NOT_FOUND' };

/**
 * Handler job `matching.expire-match` (BE-S5-05). Idempotent (A9): tải lại match `FOR UPDATE` (tuần tự hoá với thao
 * tác người dùng đồng thời) rồi để domain `expire(now)` quyết định theo state + thời gian hiện tại. Chạy lại / job cũ
 * → no-op, không event, không hiệu ứng. Chuyển trạng thái → `save` + `applyMatchTransitionEffects` cùng `tx`.
 * Payload sai dạng là lỗi lập trình → throw (pg-boss retry rồi dead-letter).
 */
export class ExpireMatch {
  constructor(private readonly deps: ExpireMatchDeps) {}

  /** Chạy trong transaction riêng (test, gọi trực tiếp). */
  async execute(payload: MatchExpiryPayload): Promise<ExpireMatchOutcome> {
    const result = await this.deps.uow.run(async (tx) => ok(await this.executeIn(tx, payload)));
    if (result.isErr()) throw new Error('unreachable');
    return result.value;
  }

  /** Chạy trong `tx` của caller (worker: `registerJob` đã mở transaction). */
  async executeIn(tx: Tx, payload: MatchExpiryPayload): Promise<ExpireMatchOutcome> {
    const id = parseId<'Match'>(payload.matchId);
    if (id.isErr()) throw new Error('matching.expire-match: matchId không hợp lệ');

    const match = await this.deps.matches.findByIdForUpdate(tx, id.value);
    if (match === null) return { kind: 'NOT_FOUND' };

    const now = this.deps.clock.now();
    const fromStatus = match.status;
    const expired = match.expire(now);
    if (expired.isErr()) return { kind: 'NOT_YET_EXPIRED', status: fromStatus };
    if (match.status === fromStatus) return { kind: 'ALREADY_CLOSED', status: fromStatus };

    await this.deps.matches.save(tx, match);
    await applyMatchTransitionEffects(this.deps, tx, match, fromStatus, now);
    return { kind: match.status === 'CLOSED_STOPPED' ? 'CLOSED_STOPPED' : 'EXPIRED', fromStatus };
  }
}
