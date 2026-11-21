import type { Result } from '@tamgiao/kernel';
import {
  respondToOpenMatch,
  type MatchResponseCommand,
  type MatchResponseDeps,
  type MatchResponseView,
  type RespondToMatchError,
} from './respond-to-open-match.js';

export interface DeclineOfferCommand extends MatchResponseCommand {
  /**
   * Lý do bỏ qua (tuỳ chọn, có thể là văn bản tự do → có thể chứa PII): chỉ lưu `matching.matches.decline_reason`,
   * không log, không đưa vào event. Chuỗi rỗng/khoảng trắng → `null`.
   */
  readonly reason?: string | null;
}

/**
 * "Bỏ qua" (màn 7–8): `OFFERED` (bất kỳ bên nào) hoặc `AWAITING_RESPONSE` (bên chưa đồng ý) → `DECLINED`; trả slot hai
 * người + ghi `pair_history` (không đề xuất lại cặp này). Người đã đồng ý → `ALREADY_RESPONDED` (dùng `WithdrawIntro`).
 */
export class DeclineOffer {
  constructor(private readonly deps: MatchResponseDeps) {}

  execute(cmd: DeclineOfferCommand): Promise<Result<MatchResponseView, RespondToMatchError>> {
    const reason = cmd.reason?.trim() ? cmd.reason.trim() : null;
    return respondToOpenMatch(this.deps, cmd, (match, now) => match.decline(cmd.userId, reason, now));
  }
}
