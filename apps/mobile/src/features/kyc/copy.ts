import type { KycMoreInfoItem, KycSlot } from './types.js';

/**
 * Văn bản tiếng Việt cho màn nộp eKYC (FE-S3-02). F6: toàn bộ chữ đặt ở đây.
 * FE-D5: không có "NFC chuẩn Bộ Công An", "VNeID", "UBND", "bảo chứng", "ký quỹ".
 */
export const KYC_COPY = {
  header: {
    title: 'Xác thực danh tính',
    back: 'Quay lại',
  },
  loading: 'Đang tải hồ sơ xác thực...',
  genericError: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
  guide: {
    title: 'Hướng dẫn chụp ảnh',
    intro:
      'Chụp 4 ảnh để chuyên viên thẩm định hồ sơ: hai mặt CCCD, ảnh chân dung và giấy xác nhận tình trạng hôn nhân.',
    tips: [
      'Chụp nơi đủ ánh sáng, không loá đèn, không bị bóng che.',
      'Đặt giấy tờ nằm trọn trong khung, chữ rõ nét, không bị mờ.',
      'Ảnh chân dung: nhìn thẳng, không đeo kính râm hay khẩu trang.',
    ],
    privacy:
      'Ảnh chỉ dùng cho việc thẩm định, không lưu vào thư viện ảnh và được xoá khỏi máy ngay sau khi tải lên.',
  },
  slots: {
    CCCD_FRONT: { label: 'CCCD mặt trước', hint: 'Mặt có ảnh chân dung và số CCCD.' },
    CCCD_BACK: { label: 'CCCD mặt sau', hint: 'Mặt có chip và mã vạch.' },
    SELFIE: { label: 'Ảnh chân dung', hint: 'Chụp bằng camera trước, khuôn mặt nằm giữa khung.' },
    MARITAL_STATUS_CERTIFICATE: {
      label: 'Giấy xác nhận tình trạng hôn nhân',
      hint: 'Chụp toàn bộ trang giấy, rõ dấu và chữ ký.',
    },
  } satisfies Record<KycSlot, { label: string; hint: string }>,
  slotStatus: {
    empty: 'Chưa chụp',
    uploading: 'Đang tải lên...',
    uploaded: 'Đã tải lên',
    previous: 'Dùng ảnh đã nộp',
    failed: 'Tải lên thất bại',
    required: 'Cần chụp lại',
  },
  actions: {
    capture: 'Chụp ảnh',
    retake: 'Chụp lại',
    usePhoto: 'Dùng ảnh này',
    cancel: 'Huỷ',
    shutter: 'Chụp',
    submit: 'Nộp hồ sơ xác thực',
    resubmit: 'Nộp bổ sung',
    goToPayment: 'Đến bước thanh toán',
    viewStatus: 'Xem trạng thái hồ sơ',
  },
  camera: {
    frameHint: {
      CCCD_FRONT: 'Đặt mặt trước CCCD vào trong khung',
      CCCD_BACK: 'Đặt mặt sau CCCD vào trong khung',
      SELFIE: 'Đưa khuôn mặt vào giữa khung',
      MARITAL_STATUS_CERTIFICATE: 'Đặt giấy xác nhận vào trong khung',
    } satisfies Record<KycSlot, string>,
    processError: 'Không xử lý được ảnh vừa chụp. Vui lòng chụp lại.',
    permissionTitle: 'Cần quyền truy cập máy ảnh',
    permissionBody: 'Tâm Giao cần dùng máy ảnh để chụp giấy tờ và ảnh chân dung khi xác thực hồ sơ.',
    permissionGrant: 'Cho phép dùng máy ảnh',
    permissionOpenSettings: 'Mở cài đặt',
  },
  preview: {
    title: 'Kiểm tra ảnh',
    hint: 'Ảnh có rõ nét, đủ sáng và không bị loá không?',
  },
  moreInfo: {
    title: 'Chuyên viên yêu cầu bổ sung',
    itemsLabel: 'Cần chụp lại:',
    noteLabel: 'Ghi chú của chuyên viên:',
    items: {
      CCCD_FRONT: 'CCCD mặt trước',
      CCCD_BACK: 'CCCD mặt sau',
      SELFIE: 'Ảnh chân dung',
      MARITAL_STATUS_CERTIFICATE: 'Giấy xác nhận tình trạng hôn nhân',
      OTHER: 'Thông tin khác (xem ghi chú)',
    } satisfies Record<KycMoreInfoItem, string>,
  },
  submitted: {
    title: 'Hồ sơ đã được nộp',
    body: 'Chuyên viên đang thẩm định hồ sơ của bạn. Bạn có thể theo dõi tiến trình ở màn trạng thái.',
  },
  submitHint: 'Chụp đủ các ảnh còn thiếu để nộp hồ sơ.',
} as const;
