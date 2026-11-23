import type { KycMoreInfoItem, KycRejectionReasonCode } from '@tamgiao/contracts/verification';
import { KYC_COPY } from './copy.js';
import type { KycStepName, StepDisplayState } from './status-model.js';
import type { KycProgressStatus } from './types.js';

/**
 * Toàn bộ văn bản hiển thị tiếng Việt cho màn hình trạng thái thẩm định hồ sơ (FE-S3-04).
 * Tuyệt đối không chứa các từ ngữ nhạy cảm hoặc cam kết ngoài thẩm quyền:
 * không "ký quỹ", "bảo chứng", "VNeID", "UBND", "Bộ Công An", "NFC", "100%",
 * "chuyên viên đồng hành", "cố vấn", không hứa thời gian xử lý cụ thể.
 */
export const VERIFICATION_STATUS_COPY = {
  header: {
    title: 'Trạng thái hồ sơ',
    back: 'Quay lại',
  },
  loading: 'Đang tải trạng thái hồ sơ...',
  genericError: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
  status: {
    NOT_SUBMITTED: {
      badge: 'Chưa nộp hồ sơ',
      title: 'Chưa nộp hồ sơ xác thực',
      body: 'Vui lòng hoàn tất nộp hồ sơ để bắt đầu quy trình thẩm định.',
    },
    DRAFT: {
      badge: 'Chưa nộp hồ sơ',
      title: 'Hồ sơ chưa hoàn tất',
      body: 'Bạn đang có hồ sơ xác thực dở dang. Vui lòng tiếp tục hoàn thiện.',
    },
    SUBMITTED: {
      badge: 'Đã nộp hồ sơ',
      title: 'Hồ sơ đang chờ thẩm định',
      body: 'Hồ sơ của bạn đã được tiếp nhận và đang chờ chuyên viên đối soát.',
    },
    UNDER_REVIEW: {
      badge: 'Đang thẩm định',
      title: 'Hồ sơ đang được thẩm định',
      body: 'Chuyên viên đang đối soát các thông tin xác thực của bạn.',
    },
    NEEDS_MORE_INFO: {
      badge: 'Cần bổ sung',
      title: 'Cần bổ sung hồ sơ',
      body: 'Chuyên viên yêu cầu bổ sung thêm thông tin để hoàn tất thẩm định.',
    },
    APPROVED: {
      badge: 'Đã duyệt',
      title: 'Hồ sơ đã được duyệt',
      body: 'Hồ sơ của bạn đã hoàn tất thẩm định. Bạn có thể bắt đầu nhận gợi ý ghép đôi.',
    },
    REJECTED: {
      badge: 'Không được duyệt',
      title: 'Hồ sơ không được duyệt',
      body: 'Hồ sơ chưa đáp ứng tiêu chuẩn thẩm định của Tâm Giao.',
    },
  } satisfies Record<KycProgressStatus, { badge: string; title: string; body: string }>,
  steps: {
    title: 'Quy trình thẩm định',
    progress: (passed: number, total: number) => `${passed}/${total} bước`,
    labels: {
      CCCD_CHIP: 'Xác thực CCCD gắn chip',
      MARITAL_STATUS: 'Xác minh tình trạng hôn nhân',
      MANUAL_REVIEW: 'Chuyên viên thẩm định hồ sơ',
      INTERVIEW: 'Phỏng vấn sơ bộ',
    } satisfies Record<KycStepName, string>,
    descriptions: {
      CCCD_CHIP: 'Đối chiếu thông tin giấy tờ tuỳ thân và ảnh chân dung.',
      MARITAL_STATUS: 'Xác nhận giấy tờ tình trạng hôn nhân hợp lệ.',
      MANUAL_REVIEW: 'Chuyên viên đối soát tính xác thực và nhất quán của hồ sơ.',
      INTERVIEW: 'Trao đổi sơ bộ để hoàn tất xác thực.',
    } satisfies Record<KycStepName, string>,
    states: {
      passed: 'Đã hoàn tất',
      failed: 'Không đạt',
      current: 'Đang xử lý',
      pending: 'Chưa bắt đầu',
    } satisfies Record<StepDisplayState, string>,
  },
  payment: {
    recorded: (amount: string) => `Đã ghi nhận phí xác thực ${amount}`,
  },
  voucher: {
    title: (amount: string) => `Voucher hẹn hò ${amount}`,
    status: {
      RESERVED: 'Đã giữ chỗ',
      ACTIVE: 'Đã kích hoạt',
    },
    reservedHint: 'Voucher kích hoạt khi hồ sơ được duyệt.',
    ttlPending: (days: number) => `Hạn dùng ${days} ngày kể từ khi hồ sơ được duyệt`,
    expiresAt: (date: string) => `Hạn dùng đến ${date}`,
    usableAt: (names: string) => `Dùng tại: ${names}`,
    anyPartner: 'Dùng tại quán đối tác của Tâm Giao',
  },
  moreInfo: {
    title: 'Thông tin cần bổ sung',
    itemsLabel: 'Cần bổ sung:',
    noteLabel: 'Ghi chú của chuyên viên:',
    cta: 'Bổ sung hồ sơ',
    items: KYC_COPY.moreInfo.items satisfies Record<KycMoreInfoItem, string>,
  },
  rejection: {
    title: 'Lý do',
    reasons: {
      INVALID_ID_DOCUMENT: 'Giấy tờ tuỳ thân không hợp lệ hoặc không rõ nét.',
      FACE_MISMATCH: 'Ảnh chân dung không trùng khớp với giấy tờ tuỳ thân.',
      INFO_MISMATCH: 'Thông tin khai báo không trùng khớp với giấy tờ.',
      MARITAL_STATUS_UNVERIFIED: 'Giấy tờ xác nhận tình trạng hôn nhân chưa hợp lệ.',
      NOT_ELIGIBLE: 'Chưa đủ điều kiện tham gia theo quy định của Tâm Giao.',
      DUPLICATE_ACCOUNT: 'Thông tin xác thực đã tồn tại trên hệ thống.',
      INTERVIEW_FAILED: 'Chưa đạt yêu cầu trong buổi phỏng vấn sơ bộ.',
      OTHER: 'Hồ sơ chưa đạt tiêu chuẩn thẩm định.',
    } satisfies Record<KycRejectionReasonCode, string>,
  },
  refund: {
    title: 'Hoàn phí xác thực',
    notStarted: (hours: number) => `Phí xác thực sẽ được hoàn lại trong vòng ${hours} giờ.`,
    deadline: (dateTime: string) => `Dự kiến hoàn tất trước ${dateTime}.`,
    pending: 'Đang xử lý hoàn tiền',
    refunded: (amount: string) => `Đã hoàn ${amount}`,
    refundedAt: (dateTime: string) => `Hoàn lúc ${dateTime}`,
  },
  approved: {
    cta: 'Bắt đầu nhận gợi ý',
  },
  notSubmitted: {
    cta: 'Tiếp tục xác thực',
  },
  privacy: {
    title: 'Bảo mật dữ liệu cá nhân',
    body: 'Dữ liệu xác thực của bạn được mã hoá và chỉ chuyên viên thẩm định được truy cập.',
  },
} as const;
