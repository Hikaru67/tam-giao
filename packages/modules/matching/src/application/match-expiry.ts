import type { ScheduledJob } from '@tamgiao/kernel';
import type { Match } from '../domain/match.js';

/** Hàng đợi job hết hạn match (pg-boss). Worker đăng ký handler `ExpireMatch` (BE-S5-05). */
export const MATCH_EXPIRY_QUEUE = 'matching.expire-match';

/** Payload job hết hạn — chỉ id, không PII. */
/** Khai báo `type` (không `interface`) để gán được vào `ScheduledJob.payload` (`Record<string, unknown>`). */
export type MatchExpiryPayload = {
  readonly matchId: string;
};

/**
 * Job hết hạn cho trạng thái hiện tại của match: khoá `<matchId>:<version>` (mỗi lần chuyển trạng thái có hạn một job
 * riêng, gửi lại cùng version → không trùng), chạy lúc `expiresAt`. Trạng thái không có hạn → `null`.
 */
export function matchExpiryJob(match: Match): ScheduledJob | null {
  const { expiresAt } = match;
  if (expiresAt === null) return null;
  const payload: MatchExpiryPayload = { matchId: match.id };
  return { queue: MATCH_EXPIRY_QUEUE, key: `${match.id}:${match.version}`, runAt: expiresAt, payload };
}
