import { registerErrors } from '../errors.js';

/** Mã lỗi phỏng vấn sơ bộ 15 phút (BE-S3-05). */
export const INTERVIEW_ERROR_CODES = registerErrors('verification', {
  /** Slot đã có người đặt (hoặc đã phỏng vấn xong) — kể cả khi hai người đặt đồng thời. */
  SLOT_TAKEN: { status: 409, title: 'Khung giờ phỏng vấn đã có người đặt' },
  /** `meta.deadline`: mốc cuối còn được huỷ/đổi lịch (giờ bắt đầu − `INTERVIEW_CHANGE_CUTOFF_HOURS`). */
  CANCEL_TOO_LATE: { status: 409, title: 'Đã quá hạn huỷ/đổi lịch phỏng vấn' },
  INTERVIEW_SLOT_IN_PAST: { status: 422, title: 'Khung giờ phỏng vấn đã qua' },
  INTERVIEW_SLOT_NOT_FOUND: { status: 404, title: 'Không tìm thấy khung giờ phỏng vấn' },
  /** Chuyên viên đã có slot khác chồng thời gian. */
  INTERVIEW_SLOT_OVERLAP: { status: 409, title: 'Khung giờ bị trùng với slot khác của chuyên viên' },
  INTERVIEW_NOT_BOOKED: { status: 409, title: 'Chưa có lịch phỏng vấn đang hoạt động' },
  INTERVIEW_NOT_STARTED: { status: 409, title: 'Buổi phỏng vấn chưa bắt đầu' },
  /** Mỗi người dùng tối đa một lịch đang hoạt động — dùng đổi lịch thay vì đặt thêm. */
  INTERVIEW_ALREADY_BOOKED: { status: 409, title: 'Đã có lịch phỏng vấn đang hoạt động' },
  INTERVIEW_ALREADY_PASSED: { status: 409, title: 'Bước phỏng vấn đã đạt' },
  /** `meta.status`: chỉ đặt lịch khi hồ sơ eKYC đã nộp và chưa quyết định. */
  INTERVIEW_REQUIRES_SUBMISSION: {
    status: 409,
    title: 'Cần nộp hồ sơ xác thực (chưa quyết định) trước khi đặt lịch phỏng vấn',
  },
});
