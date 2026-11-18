import { registerErrors } from '../errors.js';

/** Mã lỗi upload qua presigned URL (BE-S2-07). */
export const UPLOAD_ERROR_CODES = registerErrors('uploads', {
  /** Key không tồn tại hoặc thuộc người dùng khác. */
  UPLOAD_NOT_OWNED: { status: 403, title: 'Tệp tải lên không thuộc về bạn' },
  /** Sai loại tệp / kích thước / mục đích, hoặc tệp chưa được tải lên. */
  UPLOAD_INVALID: { status: 422, title: 'Tệp tải lên không hợp lệ' },
});
