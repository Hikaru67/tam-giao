import { registerErrors } from '../errors.js';

/** Mã lỗi module profile. */
export const PROFILE_ERROR_CODES = registerErrors('profile', {
  AGE_NOT_ELIGIBLE: { status: 422, title: 'Chưa đủ tuổi tham gia' },
  TOO_MANY_PHOTOS: { status: 422, title: 'Vượt quá số ảnh hồ sơ cho phép' },
  /** `meta.missing` liệt kê trường còn thiếu khi bấm "Tiếp tục". */
  PROFILE_INCOMPLETE: { status: 422, title: 'Hồ sơ chưa điền đủ thông tin bắt buộc' },
});
