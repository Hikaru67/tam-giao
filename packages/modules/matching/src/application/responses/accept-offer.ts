import type { Result } from '@tamgiao/kernel';
import {
  respondToOpenMatch,
  type MatchResponseCommand,
  type MatchResponseDeps,
  type MatchResponseView,
  type RespondToMatchError,
} from './respond-to-open-match.js';

export type AcceptOfferCommand = MatchResponseCommand;

/**
 * "Đồng ý kết nối" (màn 7–8): bên thứ nhất → `AWAITING_RESPONSE` (hạn mới `RESPONSE_TTL_HOURS`, job hết hạn mới);
 * bên thứ hai → `DATING` (hạn `DATING_DAYS`, job hết hạn mới). Lỗi: `NO_OPEN_MATCH`, `ALREADY_RESPONDED`,
 * `OFFER_EXPIRED`, `INVALID_TRANSITION` (match đang `DATING`/`MET`).
 */
export class AcceptOffer {
  constructor(private readonly deps: MatchResponseDeps) {}

  execute(cmd: AcceptOfferCommand): Promise<Result<MatchResponseView, RespondToMatchError>> {
    return respondToOpenMatch(this.deps, cmd, (match, now) => match.accept(cmd.userId, now));
  }
}
