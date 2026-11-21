/**
 * Mã lỗi nghiệp vụ của module messaging (AGENTS.md A4, BE-S6-01).
 *
 * - `MESSAGING_DOMAIN_ERRORS`: mã do messaging sở hữu, đăng ký ở `@tamgiao/contracts` (`messaging/errors.ts`).
 * - `MESSAGING_REUSED_ERRORS`: mã đã được module khác đăng ký, messaging dùng lại đúng nghĩa (registry cấm đăng ký
 *   trùng): `NOT_PARTICIPANT` (matching), `RATE_LIMITED`, `NOT_FOUND`, `INVALID_ID` (common).
 *
 * Test `messaging-contracts.test.ts` kiểm tra mọi mã đều có trong registry với đúng owner + HTTP status.
 */
export const MESSAGING_DOMAIN_ERRORS = ['CONVERSATION_CLOSED', 'MESSAGE_EMPTY', 'MESSAGE_TOO_LONG'] as const;
export type MessagingDomainErrorCode = (typeof MESSAGING_DOMAIN_ERRORS)[number];

export const MESSAGING_REUSED_ERRORS = [
  'NOT_PARTICIPANT',
  'RATE_LIMITED',
  'NOT_FOUND',
  'INVALID_ID',
] as const;
