import type { DomainError } from '@tamgiao/kernel';

/**
 * Mã lỗi tìm ứng viên (BE-S5-03), đăng ký ở `@tamgiao/contracts` (`matching/candidate-dto.ts`).
 * `CANDIDATE_PROFILE_NOT_FOUND`: người cần tìm ứng viên chưa có trong read model (chưa hoàn tất hồ sơ + tiêu chí).
 */
export const CANDIDATE_ERROR_CODES = ['CANDIDATE_PROFILE_NOT_FOUND'] as const;
export type CandidateError = DomainError<(typeof CANDIDATE_ERROR_CODES)[number]>;
