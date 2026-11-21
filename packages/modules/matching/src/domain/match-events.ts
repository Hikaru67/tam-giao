/**
 * Tên event của aggregate `Match`. Domain không được import contracts ngoài `constants` (A1) nên giữ bản sao ở đây;
 * test `matching-errors.test.ts` bảo đảm khớp với `@tamgiao/contracts` (`matching/events.ts`), nơi khai báo payload.
 */
export const MATCH_OFFERED = 'MatchOffered';
export const MATCH_AWAITING_RESPONSE = 'MatchAwaitingResponse';
export const MATCH_STARTED_DATING = 'MatchStartedDating';
export const MATCH_DECLINED = 'MatchDeclined';
export const MATCH_EXPIRED = 'MatchExpired';
export const MATCH_MET = 'MatchMet';
export const MATCH_CLOSED = 'MatchClosed';
export const MATCH_LOCKED = 'MatchLocked';

export const MATCH_EVENT_TYPES = [
  MATCH_OFFERED,
  MATCH_AWAITING_RESPONSE,
  MATCH_STARTED_DATING,
  MATCH_DECLINED,
  MATCH_EXPIRED,
  MATCH_MET,
  MATCH_CLOSED,
  MATCH_LOCKED,
] as const;

export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];
