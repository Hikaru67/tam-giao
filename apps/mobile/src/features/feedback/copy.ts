import type {
  FEEDBACK_DECISION_NAMES,
  FEEDBACK_FEELING_NAMES,
  FEEDBACK_PROFILE_MATCH_NAMES,
  FEEDBACK_STOP_REASON_NAMES,
} from '@tamgiao/contracts/dating';

export const FEEDBACK_PROFILE_MATCH_COPY = {
  FULL_MATCH: 'Khớp hoàn toàn',
  MOSTLY_MATCH: 'Khá tương đồng',
  DIFFERENT: 'Có khác biệt',
} as const satisfies Record<(typeof FEEDBACK_PROFILE_MATCH_NAMES)[number], string>;

export const FEEDBACK_FEELING_COPY = {
  DEEP_INTEREST: 'Rất muốn tìm hiểu sâu hơn',
  NEED_MORE_TIME: 'Cần thêm thời gian quan sát',
  NOT_A_FIT: 'Cảm thấy chưa phù hợp',
} as const satisfies Record<(typeof FEEDBACK_FEELING_NAMES)[number], string>;

export const FEEDBACK_DECISION_COPY = {
  A_COMMIT: 'Tiến tới cam kết gắn kết',
  B_STOP: 'Dừng tìm hiểu văn minh',
} as const satisfies Record<(typeof FEEDBACK_DECISION_NAMES)[number], string>;

export const FEEDBACK_STOP_REASON_COPY = {
  LIFESTYLE_DIFFERENCE: 'Khác biệt về lối sống & thói quen',
  NO_SPARK: 'Chưa có cảm xúc rung động',
  FINANCE_FAMILY_PLAN_DIFFERENCE: 'Khác biệt kế hoạch tài chính / gia đình',
} as const satisfies Record<(typeof FEEDBACK_STOP_REASON_NAMES)[number], string>;

export const FEEDBACK_COPY = {
  header: {
    title: 'Đánh giá sau buổi gặp',
    back: 'Quay lại',
    backIcon: '←',
  },
  confidentialNotice: 'Chỉ chuyên viên xem được. Đối phương không thấy câu trả lời của bạn.',
  sections: {
    rating: {
      title: 'Ấn tượng về đối phương',
      subtitle: 'Đánh giá mức độ chân thành và ứng xử lịch thiệp',
    },
    profileMatch: {
      title: 'Ngoại hình & phong thái',
      subtitle: 'Tính trung thực của hình ảnh so với thực tế',
    },
    feeling: {
      title: 'Cảm xúc kết nối',
      subtitle: 'Đánh giá sự hòa hợp và chiều sâu chia sẻ',
    },
    decision: {
      title: 'Quyết định định hướng',
      subtitle: 'Lựa chọn của bạn cho bước tiếp theo',
    },
    stopReasons: {
      title: 'Lý do kín đáo',
      subtitle: 'Chỉ dùng để chuyên viên hỗ trợ tốt hơn',
    },
    stopNote: {
      title: 'Chia sẻ thêm',
      placeholder: 'Ghi chú thêm nếu bạn có điều muốn chia sẻ với chuyên viên...',
    },
  },
  stars: {
    label: (n: number) => `${n} sao`,
  },
  form: {
    submitButton: 'Xác nhận gửi đánh giá',
    noteCounter: (current: number, max: number) => `${current}/${max}`,
    noteTooLong: (max: number) => `Ghi chú không được vượt quá ${max} ký tự`,
    cooldownNotice: (days: number) =>
      `Hệ thống sẽ tạm dừng ghép đôi trong ${days} ngày để bạn cân bằng cảm xúc trước khi nhận đề xuất mới.`,
    notAllowedExplanation: 'Vui lòng chờ tới giờ hẹn để thực hiện đánh giá buổi gặp.',
  },
  confirmSheet: {
    title: 'Xác nhận gửi đánh giá',
    bodyCommit: 'Đánh giá không thể chỉnh sửa sau khi gửi. Bạn có chắc chắn muốn gửi đánh giá?',
    bodyStop: (days: number) =>
      `Đánh giá không thể chỉnh sửa sau khi gửi. Kết nối sẽ dừng lại và bạn sẽ có khoảng nghỉ ${days} ngày trước khi nhận đề xuất mới.`,
    confirm: 'Xác nhận gửi',
    cancel: 'Kiểm tra lại',
  },
  result: {
    waiting: {
      title: 'Đang chờ người kia',
      description: 'Bạn đã chọn tiến tới cam kết gắn kết. Hệ thống đang chờ phản hồi từ người còn lại.',
    },
    closed: {
      title: 'Kết nối đã khép lại',
      description: 'Cảm ơn bạn đã chia sẻ đánh giá sau buổi gặp.',
    },
    stopped: {
      title: 'Bạn đã dừng tìm hiểu',
      description: (days: number) =>
        `Bạn đã chọn dừng tìm hiểu. Hệ thống sẽ tạm dừng ghép đôi trong ${days} ngày để bạn cân bằng cảm xúc.`,
    },
  },
  review: {
    title: 'Đánh giá của bạn',
    subtitle: 'Nội dung phản hồi kín đã gửi cho chuyên viên',
    ratingLabel: 'Ấn tượng',
    ratingValue: (n: number, max: number) => `${n}/${max} sao`,
    profileMatchLabel: 'Ngoại hình & phong thái',
    feelingLabel: 'Cảm xúc kết nối',
    decisionLabel: 'Quyết định',
    stopReasonsLabel: 'Lý do kín',
    stopNoteLabel: 'Ghi chú',
  },
  entry: {
    giveFeedback: 'Đánh giá buổi gặp',
    viewFeedback: 'Xem đánh giá của bạn',
  },
  loading: 'Đang tải thông tin đánh giá...',
} as const;
