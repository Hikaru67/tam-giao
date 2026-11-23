import type { INTERVIEW_OUTCOME_VALUES, INTERVIEW_SLOT_STATUS_VALUES } from '@tamgiao/contracts/verification';

export type InterviewSlotStatus = (typeof INTERVIEW_SLOT_STATUS_VALUES)[number];
export type InterviewOutcome = (typeof INTERVIEW_OUTCOME_VALUES)[number];

export const INTERVIEWS_COPY = {
  description: 'Mở slot phỏng vấn sơ bộ và ghi nhận xét, kết quả sau khi phỏng vấn ứng viên.',
  prevWeek: 'Tuần trước',
  nextWeek: 'Tuần sau',
  currentWeek: 'Tuần này',
  timezoneNotice: 'Giờ hiển thị theo múi giờ của máy bạn',
  openSlotButton: 'Mở slot',
  emptyDay: 'Chưa có slot',
  legendTitle: 'Chú thích trạng thái',
  loading: 'Đang tải lịch phỏng vấn...',
  dismissNotice: 'Đóng thông báo',
  statusLabels: {
    OPEN: 'Còn trống',
    BOOKED: 'Đã có người đặt',
    COMPLETED: 'Đã phỏng vấn',
  } satisfies Record<InterviewSlotStatus, string>,
  outcomeLabels: {
    PASSED: 'Đạt',
    FAILED: 'Không đạt',
  } satisfies Record<InterviewOutcome, string>,
  openSlotModal: {
    title: 'Mở slot phỏng vấn',
    startsAtLabel: 'Giờ bắt đầu',
    durationHint: (minutes: number) => `Mỗi slot kéo dài ${minutes} phút.`,
    meetingUrlLabel: 'Link gọi video (tuỳ chọn)',
    meetingUrlPlaceholder: 'https://meet.google.com/...',
    submit: 'Tạo slot',
    cancel: 'Huỷ',
    errors: {
      startsAtRequired: 'Vui lòng chọn giờ bắt đầu.',
      meetingUrlInvalid: 'Link phải bắt đầu bằng http:// hoặc https://',
    },
    successNotice: 'Đã mở slot phỏng vấn.',
  },
  notesModal: {
    title: 'Ghi chú phỏng vấn',
    timeLabel: 'Thời gian slot',
    outcomeLabel: 'Kết quả',
    notesLabel: 'Nhận xét',
    notesPlaceholder: 'Nhập đánh giá ứng viên, ấn tượng, tính xác thực...',
    submit: 'Lưu ghi chú',
    cancel: 'Huỷ',
    errors: {
      outcomeRequired: 'Vui lòng chọn kết quả.',
      notesRequired: 'Vui lòng nhập nhận xét.',
    },
    successNotice: 'Đã lưu ghi chú phỏng vấn.',
  },
  slotAriaLabel: (timeRange: string, status: string) => `${timeRange} · ${status}`,
} as const;
