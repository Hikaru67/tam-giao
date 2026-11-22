/**
 * Event payload của aggregate `Match` (phát qua outbox, BE-S5-01). Không chứa PII: chỉ id, trạng thái, mã phân loại.
 * Ghi chú chuyên viên và lý do "Bỏ qua" (có thể là văn bản tự do) KHÔNG nằm trong event. Thời gian dạng ISO 8601 UTC.
 */

/** Trạng thái match (khớp `MATCH_STATUSES` trong domain matching). */
export const MATCH_STATUS_NAMES = [
  'OFFERED',
  'AWAITING_RESPONSE',
  'DATING',
  'MET',
  'CLOSED_SUCCESS',
  'CLOSED_STOPPED',
  'EXPIRED',
  'DECLINED',
  'LOCKED',
] as const;
export type MatchStatusName = (typeof MATCH_STATUS_NAMES)[number];

export const MATCH_CLOSE_OUTCOME_NAMES = ['SUCCESS', 'STOPPED'] as const;
export type MatchCloseOutcomeName = (typeof MATCH_CLOSE_OUTCOME_NAMES)[number];

/** `MANUAL`: đóng qua thao tác dừng / feedback; `DATING_PERIOD_ENDED`: hết `DATING_DAYS` (job hết hạn). */
export const MATCH_CLOSE_TRIGGER_NAMES = ['MANUAL', 'DATING_PERIOD_ENDED'] as const;
export type MatchCloseTriggerName = (typeof MATCH_CLOSE_TRIGGER_NAMES)[number];

/** Chuyên viên đề xuất ghép đôi → `OFFERED`. `expiresAt` = hạn suy nghĩ (`OFFER_TTL_HOURS`). */
export const MATCH_OFFERED = 'MatchOffered';
export interface MatchOfferedPayload {
  readonly matchId: string;
  readonly participantIds: readonly string[];
  readonly createdBy: string;
  readonly expiresAt: string;
}

/** Bên thứ nhất đồng ý → `AWAITING_RESPONSE`. `expiresAt` = hạn chờ đối phương (`RESPONSE_TTL_HOURS`). */
export const MATCH_AWAITING_RESPONSE = 'MatchAwaitingResponse';
export interface MatchAwaitingResponsePayload {
  readonly matchId: string;
  readonly participantIds: readonly string[];
  readonly acceptedBy: string;
  readonly awaitingUserId: string;
  readonly expiresAt: string;
}

/** Cả hai đồng ý → `DATING`. `expiresAt` = hết giai đoạn tìm hiểu (`DATING_DAYS`). */
export const MATCH_STARTED_DATING = 'MatchStartedDating';
export interface MatchStartedDatingPayload {
  readonly matchId: string;
  readonly participantIds: readonly string[];
  readonly expiresAt: string;
}

/** `DECLINED`: bỏ qua (`withdrawn=false`) hoặc người đã đồng ý rút lời ngỏ (`withdrawn=true`). */
export const MATCH_DECLINED = 'MatchDeclined';
export interface MatchDeclinedPayload {
  readonly matchId: string;
  readonly participantIds: readonly string[];
  readonly declinedBy: string;
  readonly fromStatus: MatchStatusName;
  readonly withdrawn: boolean;
}

/** Hết hạn suy nghĩ / chờ phản hồi → `EXPIRED`. `acceptedBy`: những người đã đồng ý trước khi hết hạn. */
export const MATCH_EXPIRED = 'MatchExpired';
export interface MatchExpiredPayload {
  readonly matchId: string;
  readonly participantIds: readonly string[];
  readonly fromStatus: MatchStatusName;
  readonly acceptedBy: readonly string[];
}

/** Buổi hẹn đã diễn ra: `DATING → MET` (chờ feedback). */
export const MATCH_MET = 'MatchMet';
export interface MatchMetPayload {
  readonly matchId: string;
  readonly participantIds: readonly string[];
}

/**
 * Match đóng → `CLOSED_SUCCESS` | `CLOSED_STOPPED` (`CLOSED_STOPPED` do dừng tìm hiểu kéo theo cooldown `COOLDOWN_DAYS`;
 * hết `DATING_DAYS` chưa gặp thì không — BE-S7-04).
 * Hết `DATING_DAYS` cũng phát event này (`trigger = DATING_PERIOD_ENDED`), không phát `MatchExpired`.
 */
export const MATCH_CLOSED = 'MatchClosed';
export interface MatchClosedPayload {
  readonly matchId: string;
  readonly participantIds: readonly string[];
  readonly outcome: MatchCloseOutcomeName;
  readonly fromStatus: MatchStatusName;
  readonly trigger: MatchCloseTriggerName;
}

/** Match bị khoá (vd báo cáo an toàn). `reason` là mã phân loại, không PII. */
export const MATCH_LOCKED = 'MatchLocked';
export interface MatchLockedPayload {
  readonly matchId: string;
  readonly participantIds: readonly string[];
  readonly fromStatus: MatchStatusName;
  readonly reason: string;
}
