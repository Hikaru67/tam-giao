export const DECLINE_REASONS = [
  { id: 'distance', label: 'Khoảng cách địa lý hoặc khu vực sinh sống' },
  { id: 'marriage_timing', label: 'Kế hoạch thời điểm kết hôn chưa đồng điệu' },
  { id: 'career', label: 'Khác biệt về định hướng công việc / thời gian' },
  { id: 'no_spark', label: 'Chưa cảm nhận được sự rung động qua hồ sơ' },
] as const;

export const MATCH_COPY = {
  header: {
    title: 'Gợi ý ghép đôi',
    settings: 'Cài đặt',
    inbox: 'Hộp thư',
  },
  loading: 'Đang tải gợi ý ghép đôi...',
  genericError: 'Có lỗi xảy ra. Vui lòng thử lại sau.',
  offer: {
    badge: 'Gợi ý độc quyền 1-1',
    counterpartAccepted: 'Đối phương đã đồng ý, đang chờ phản hồi của bạn.',
    countdownLabel: 'Thời gian suy nghĩ còn lại',
    exclusiveHint: 'Mỗi lúc bạn chỉ có một gợi ý duy nhất. Hãy dành thời gian tìm hiểu thật kỹ.',
    acceptHint:
      'Khi đồng ý, bạn sẽ chờ đối phương phản hồi và không nhận thêm gợi ý khác cho tới khi có kết quả.',
    nameAge: (name: string, age: number) => `${name}, ${age}`,
    bioTitle: 'Lời tự bạch',
    interestsTitle: 'Sở thích',
    photoLabel: (name: string, index: number, total: number) => `Ảnh ${index}/${total} của ${name}`,
    noPhoto: 'Chưa có ảnh hồ sơ',
    viewProfile: 'Xem chi tiết hồ sơ',
    accept: 'Đồng ý kết nối',
    decline: 'Bỏ qua',
  },
  expired: {
    title: 'Gợi ý đã hết thời gian phản hồi',
    description: 'Chuyên viên đang tìm gợi ý mới phù hợp với bạn.',
    refresh: 'Làm mới',
  },
  searching: {
    title: 'Đang tìm gợi ý mới',
    description: 'Chúng tôi sẽ thông báo ngay khi có người phù hợp với bạn.',
    refresh: 'Làm mới',
  },
  acceptSheet: {
    title: 'Đồng ý kết nối?',
    body: 'Khi đồng ý, bạn sẽ chờ đối phương phản hồi và không nhận thêm gợi ý khác cho tới khi có kết quả.',
    confirm: 'Đồng ý kết nối',
    cancel: 'Để sau',
  },
  declineSheet: {
    title: 'Bỏ qua gợi ý này?',
    body: 'Bạn có thể chọn lý do để chuyên viên gợi ý phù hợp hơn. Lý do không được gửi cho đối phương.',
    confirm: 'Xác nhận bỏ qua',
    cancel: 'Huỷ',
  },
  declineReasons: DECLINE_REASONS,
  waiting: {
    badge: 'Đang chờ phản hồi',
    title: (name: string) => `Bạn đã gửi lời ngỏ tới ${name}`,
    titleWithoutName: 'Bạn đã gửi lời ngỏ tới đối phương',
    countdownPrefix: 'Thời gian phản hồi còn lại:',
    maxResponseHours: (hours: number) => `Tối đa ${hours} giờ`,
    expiredHint: (hours: number) =>
      `Nếu sau ${hours} giờ đối phương chưa phản hồi, gợi ý này sẽ khép lại và bạn có thể nhận gợi ý mới.`,
    principlesTitle: 'Nguyên tắc ghép đôi 1-1',
    principles: {
      exclusive: 'Một người tại một thời điểm: Bạn và đối phương đều không nhận thêm gợi ý khác.',
      datingDays: (days: number) => `Mở kênh trò chuyện ${days} ngày khi đối phương đồng ý kết nối.`,
      withdrawRight: 'Bạn có quyền rút lại lời ngỏ bất cứ lúc nào trước khi đối phương phản hồi.',
    },
    viewProfile: 'Xem hồ sơ',
    withdraw: 'Rút lại lời ngỏ',
    expiredTitle: 'Đã hết thời gian chờ phản hồi',
    expiredDescription: 'Chuyên viên đang tìm gợi ý mới phù hợp với bạn.',
    refresh: 'Làm mới',
  },
  withdrawSheet: {
    title: 'Rút lại lời ngỏ?',
    body: 'Bạn có chắc chắn muốn rút lại lời ngỏ kết nối? Bạn sẽ quay về trạng thái tìm kiếm gợi ý mới.',
    confirm: 'Xác nhận rút lại',
    cancel: 'Để sau',
  },
  dating: {
    openChat: 'Vào trò chuyện',
    openingChat: 'Đang mở phòng trò chuyện…',
  },
  toast: {
    accepted: 'Đã gửi lời đồng ý.',
    declined: 'Đã bỏ qua gợi ý.',
    withdrawn: 'Đã rút lại lời ngỏ.',
  },
  phases: {
    DATING: {
      title: 'Đang trong giai đoạn tìm hiểu',
      description: 'Hai bạn đã đồng ý kết nối và đang trong giai đoạn tìm hiểu độc quyền.',
    },
    MET: {
      title: 'Hai bạn đã gặp nhau',
      description: 'Hai bạn đã hoàn thành buổi gặp mặt trực tiếp.',
    },
  },
} as const;
