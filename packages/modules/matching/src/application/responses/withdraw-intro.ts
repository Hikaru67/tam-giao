import type { Result } from '@tamgiao/kernel';
import {
  respondToOpenMatch,
  type MatchResponseCommand,
  type MatchResponseDeps,
  type MatchResponseView,
  type RespondToMatchError,
} from './respond-to-open-match.js';

export type WithdrawIntroCommand = MatchResponseCommand;

/**
 * "Rút lại lời ngỏ" (màn 9): chỉ người đã đồng ý, khi đang `AWAITING_RESPONSE` → `DECLINED{withdrawn}`; trả slot hai
 * người + ghi `pair_history`. Bên chưa đồng ý / trạng thái khác → `INVALID_TRANSITION`; quá hạn → `OFFER_EXPIRED`.
 */
export class WithdrawIntro {
  constructor(private readonly deps: MatchResponseDeps) {}

  execute(cmd: WithdrawIntroCommand): Promise<Result<MatchResponseView, RespondToMatchError>> {
    return respondToOpenMatch(this.deps, cmd, (match, now) => match.withdraw(cmd.userId, now));
  }
}
