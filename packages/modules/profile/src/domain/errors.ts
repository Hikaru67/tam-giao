/** Mã lỗi nghiệp vụ module profile (AGENTS.md A4) — đăng ký HTTP status ở `@tamgiao/contracts`. */
export const PROFILE_ERRORS = [
  'AGE_NOT_ELIGIBLE',
  'TOO_MANY_PHOTOS',
  'PROFILE_INCOMPLETE',
  'INVALID_CORE_TRAITS',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'UPLOAD_NOT_OWNED',
  'UPLOAD_INVALID',
] as const;

export type ProfileErrorCode = (typeof PROFILE_ERRORS)[number];
