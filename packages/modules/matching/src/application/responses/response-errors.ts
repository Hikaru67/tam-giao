/**
 * Mã lỗi riêng của use case phản hồi lời ngỏ (BE-S5-05), đăng ký HTTP status ở `@tamgiao/contracts`
 * (`matching/response-errors.ts`) — test `match-responses.test.ts` kiểm tra điều này.
 */
export const MATCH_RESPONSE_ERROR_CODES = ['NO_OPEN_MATCH'] as const;
export type MatchResponseErrorCode = (typeof MATCH_RESPONSE_ERROR_CODES)[number];
