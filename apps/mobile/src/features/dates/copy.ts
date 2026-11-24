import type { DatePlanStatusName } from '@tamgiao/contracts/dating';
import type { DateTimeSlotId } from './date-options.js';

export const DATES_COPY = {
  header: {
    title: 'Đặt lịch gặp mặt',
    back: 'Quay lại',
    backIcon: '←',
  },
  loading: 'Đang tải thông tin lịch hẹn...',
  when: (date: string, start: string, end: string) => `${date} • ${start} - ${end}`,
  partnerFallback: 'Điểm hẹn đối tác',
  notDating: {
    title: 'Chưa thể đặt lịch hẹn',
    description: 'Bạn cần đang trong giai đoạn tìm hiểu để đặt lịch.',
  },
  emptyPartners: {
    title: 'Chưa có điểm hẹn khả dụng',
    description: 'Hiện chưa có quán đối tác nào hoạt động.',
    retry: 'Thử lại',
  },
  proposal: {
    stepTimeTitle: '1. Chọn thời gian',
    stepTimeSubtitle: 'Khung giờ gợi ý cho buổi gặp đầu',
    stepPartnerTitle: '2. Chọn điểm hẹn đối tác',
    staffBooking: {
      title: 'Chuyên viên xác nhận đặt bàn',
      description: 'Chuyên viên hỗ trợ liên hệ đặt bàn trước tại quán đối tác.',
    },
    voucherNote: 'Voucher của người mời (nếu có) được kích hoạt khi lịch được xác nhận.',
    safetyGuidelines: {
      title: 'Quy tắc ứng xử an toàn Tâm Giao',
      body: 'Không nhận quà tặng có giá trị cao, tuyệt đối không giao dịch tiền hoặc bàn chuyện đầu tư trong buổi hẹn đầu tiên.',
    },
    slotLabel: (start: string, end: string, hint: string) => `${start} - ${end} (${hint})`,
    slotHints: {
      morning: 'Buổi sáng',
      afternoon: 'Buổi chiều',
    } as const satisfies Record<DateTimeSlotId, string>,
    noDaysAvailable: 'Không còn ngày hẹn khả dụng trong giai đoạn tìm hiểu.',
    submit: (name: string) => `Gửi lời mời hẹn tới ${name}`,
    submitGeneric: 'Gửi lời mời hẹn',
    submitHint: (hours: number) =>
      `Đối phương có ${hours} giờ để xác nhận. Lịch hẹn chỉ chốt khi cả hai đồng ý.`,
  },
  card: {
    title: 'Lịch hẹn gặp mặt',
    staffBookingBadge: 'Chuyên viên đặt bàn',
    statusBadge: {
      PROPOSED: 'Chờ xác nhận',
      CONFIRMED: 'Đã xác nhận',
      CHECKED_IN: 'Đang diễn ra',
      COMPLETED: 'Đã hoàn thành',
      DECLINED: 'Đã từ chối',
      EXPIRED: 'Đã hết hạn',
      CANCELLED: 'Đã huỷ',
    } as const satisfies Record<DatePlanStatusName, string>,
    views: {
      proposedInviter: (name: string, hours: number) => `Đang chờ ${name} xác nhận trong ${hours} giờ`,
      proposedInviterGeneric: (hours: number) => `Đang chờ đối phương xác nhận trong ${hours} giờ`,
      proposedInvitee: 'Bạn nhận được lời mời hẹn gặp mặt',
      proposedExpired: 'Lịch hẹn đã quá hạn xác nhận.',
      confirmed: 'Lịch hẹn đã được xác nhận',
      inProgress: 'Buổi hẹn đang diễn ra tại quán',
      awaitingFeedback: 'Buổi hẹn đã kết thúc',
      completed: 'Buổi hẹn đã hoàn thành',
      endedDeclined: 'Lời mời hẹn đã bị từ chối.',
      endedExpired: 'Lời mời hẹn đã hết hạn.',
      endedCancelled: 'Lịch hẹn đã bị huỷ.',
    },
    cancelCutoffNotice: (hours: number, deadline: string) =>
      `Chỉ có thể huỷ trước giờ bắt đầu ít nhất ${hours} giờ (trước ${deadline}). Hiện đã quá mốc huỷ.`,
    actions: {
      confirm: 'Đồng ý',
      decline: 'Từ chối',
      cancel: 'Huỷ lịch hẹn',
      refresh: 'Làm mới',
    },
  },
  sheets: {
    confirm: {
      title: 'Xác nhận lịch hẹn',
      body: 'Bạn có chắc chắn muốn đồng ý lời mời gặp mặt này không?',
      confirm: 'Xác nhận đồng ý',
      keep: 'Đóng',
    },
    decline: {
      title: 'Từ chối lịch hẹn',
      body: 'Bạn có chắc chắn muốn từ chối lời mời gặp mặt này không?',
      confirm: 'Xác nhận từ chối',
      keep: 'Giữ lại',
    },
    cancel: {
      title: 'Huỷ lịch hẹn',
      body: 'Bạn có chắc chắn muốn huỷ lịch hẹn đã xác nhận không?',
      confirm: 'Xác nhận huỷ',
      keep: 'Không huỷ',
    },
  },
  toasts: {
    proposed: 'Đã gửi lời mời hẹn thành công',
    confirmed: 'Đã xác nhận lịch hẹn',
    declined: 'Đã từ chối lịch hẹn',
    cancelled: 'Đã huỷ lịch hẹn thành công',
  },
  errors: {
    cancelTooLate: (hours: number) => `Chỉ có thể huỷ lịch hẹn trước ít nhất ${hours} giờ`,
  },
} as const;
