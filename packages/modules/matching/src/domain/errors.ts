/**
 * Mã lỗi nghiệp vụ tầng domain của aggregate `Match` (AGENTS.md A4, BE-S5-01).
 * Mỗi mã phải được đăng ký HTTP status ở `@tamgiao/contracts` (`matching/errors.ts`) — test
 * `matching-errors.test.ts` kiểm tra điều này. Mã lỗi active slot / cooldown (BE-S5-02) nằm ở `slot-errors`.
 */
export const MATCHING_DOMAIN_ERRORS = [
  'INVALID_TRANSITION',
  'OFFER_EXPIRED',
  'NOT_PARTICIPANT',
  'NOT_YET_EXPIRED',
  'ALREADY_RESPONDED',
] as const;

export type MatchingDomainErrorCode = (typeof MATCHING_DOMAIN_ERRORS)[number];
