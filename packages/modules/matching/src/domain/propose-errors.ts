/**
 * Mã lỗi riêng của use case `ProposeMatch` (BE-S5-04), đăng ký HTTP status ở `@tamgiao/contracts`
 * (`matching/propose-errors.ts`) — test `propose-match.test.ts` kiểm tra điều này.
 */
export const PROPOSE_MATCH_ERROR_CODES = [
  'MATCH_SAME_USER',
  'USER_NOT_VERIFIED',
  'HARD_FILTER_MISMATCH',
] as const;
export type ProposeMatchErrorCode = (typeof PROPOSE_MATCH_ERROR_CODES)[number];
