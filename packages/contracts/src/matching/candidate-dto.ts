import { registerErrors } from '../errors.js';

/** Mã lỗi tìm ứng viên ghép đôi (BE-S5-03). DTO HTTP của danh sách ứng viên bổ sung ở BE-S5-07. */
export const CANDIDATE_ERROR_CODES = registerErrors('matching', {
  /** Người dùng chưa có trong read model `matching.candidate_profiles` (chưa hoàn tất hồ sơ + tiêu chí bạn đời). */
  CANDIDATE_PROFILE_NOT_FOUND: { status: 404, title: 'Người dùng chưa đủ hồ sơ để tìm ứng viên' },
});
