import { err, fail, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { Match, MatchResponseError, MatchStatus } from '../../domain/match.js';
import type { MatchRepository } from '../ports/match-repository.js';
import { applyMatchTransitionEffects, type MatchTransitionEffectsDeps } from './match-transition-effects.js';
import type { MatchResponseErrorCode } from './response-errors.js';

export interface MatchResponseDeps extends MatchTransitionEffectsDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly matches: MatchRepository;
}

/** Lệnh chung của các nút phản hồi lời ngỏ: chỉ cần người dùng đang đăng nhập (route `POST /me/match/...`). */
export interface MatchResponseCommand {
  readonly userId: string;
}

/** Kết quả trả cho app sau khi phản hồi: trạng thái mới + hạn mới (để đếm ngược), `null` nếu không còn hạn. */
export interface MatchResponseView {
  readonly matchId: string;
  readonly status: MatchStatus;
  readonly expiresAt: Date | null;
}

export type RespondToMatchError = MatchResponseError | DomainError<MatchResponseErrorCode>;

/**
 * Khung chung của `AcceptOffer` / `DeclineOffer` / `WithdrawIntro`, **một transaction**:
 * 1. `findOpenByUser` (đọc không khoá) tìm match đang mở của người dùng — không có → `NO_OPEN_MATCH`.
 * 2. `findByIdForUpdate` khoá dòng match → tuần tự hoá với job hết hạn / bên còn lại bấm cùng lúc; đọc lại state mới
 *    nhất đã commit. Nếu trong lúc chờ khoá job hết hạn đã thắng (`EXPIRED`) → `OFFER_EXPIRED` (cùng mã với trường hợp
 *    người dùng thắng khoá nhưng đã quá hạn, để app nhận một kết quả duy nhất cho "bấm đúng lúc hết hạn").
 * 3. Hành động domain (`act`) → lỗi thì trả nguyên lỗi domain, không ghi gì.
 * 4. `matches.save` (+ `match_events` + outbox) → `applyMatchTransitionEffects` (job hạn mới / trả slot / pair_history).
 */
export async function respondToOpenMatch(
  deps: MatchResponseDeps,
  cmd: MatchResponseCommand,
  act: (match: Match, now: Date) => Result<void, MatchResponseError>,
): Promise<Result<MatchResponseView, RespondToMatchError>> {
  return deps.uow.run(async (tx) => {
    const open = await deps.matches.findOpenByUser(tx, cmd.userId);
    if (open === null) return fail('NO_OPEN_MATCH');
    const match = await deps.matches.findByIdForUpdate(tx, open.id);
    if (match === null) throw new Error(`match ${open.id} biến mất khi khoá`);
    if (match.status === 'EXPIRED') return fail('OFFER_EXPIRED', { status: match.status, expiresAt: null });

    const now = deps.clock.now();
    const previousStatus = match.status;
    const acted = act(match, now);
    if (acted.isErr()) return err(acted.error);

    await deps.matches.save(tx, match);
    await applyMatchTransitionEffects(deps, tx, match, previousStatus, now);
    return ok({ matchId: match.id, status: match.status, expiresAt: match.expiresAt });
  });
}
