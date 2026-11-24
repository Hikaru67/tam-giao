import type { VoucherStatusDto } from '@tamgiao/contracts/billing';
import type {
  FEEDBACK_DECISION_NAMES,
  FEEDBACK_FEELING_NAMES,
  FEEDBACK_PROFILE_MATCH_NAMES,
  FEEDBACK_STOP_REASON_NAMES,
} from '@tamgiao/contracts/dating';
import type { RECONCILIATION_CHECK_VALUES, RECONCILIATION_STATUS_VALUES } from '@tamgiao/contracts/billing';

export type FeedbackProfileMatchName = (typeof FEEDBACK_PROFILE_MATCH_NAMES)[number];
export type FeedbackFeelingName = (typeof FEEDBACK_FEELING_NAMES)[number];
export type FeedbackDecisionName = (typeof FEEDBACK_DECISION_NAMES)[number];
export type FeedbackStopReasonName = (typeof FEEDBACK_STOP_REASON_NAMES)[number];
export type ReconciliationStatusValue = (typeof RECONCILIATION_STATUS_VALUES)[number];
export type ReconciliationCheckValue = (typeof RECONCILIATION_CHECK_VALUES)[number];

export const APPEARANCE_FLAGS_COPY = {
  title: 'Cờ khác biệt eKYC',
  subtitle: 'Hàng chờ đối soát đánh giá sau buổi gặp báo cáo có sự khác biệt ngoại hình so với hồ sơ eKYC.',
  listTitle: 'Hàng chờ cờ khác biệt',
  placeholderTitle: 'Chọn một cờ để xem chi tiết',
  placeholderDescription:
    'Chọn đánh giá từ hàng chờ bên trái để đối soát nội dung với hồ sơ eKYC của người dùng.',
  loadMore: 'Tải thêm cờ',
  empty: 'Không có cờ khác biệt nào',
  emptyDescription: 'Hiện không có đánh giá nào ghi nhận sự khác biệt ngoại hình.',
  submittedAt: 'Thời điểm gửi',
  flagId: 'Mã cờ',
  authorId: 'Người gửi đánh giá',
  subjectId: 'Người bị đánh giá',
  matchId: 'Mã ghép đôi',
  datePlanId: 'Mã lịch hẹn',
  confidentialWarning: 'Nội dung kín — chỉ chuyên viên xem, lượt xem được ghi nhật ký',
  notFound: 'Không tìm thấy thông tin đánh giá.',
  retry: 'Thử lại',
  sectionGeneral: 'Thông tin chung',
  sectionEvaluation: 'Nội dung đánh giá',
  sectionDecision: 'Quyết định sau buổi gặp',
  ratingLabel: 'Đánh giá ấn tượng',
  profileMatchLabel: 'Mức độ khớp ngoại hình',
  feelingLabel: 'Cảm xúc kết nối',
  decisionLabel: 'Quyết định',
  stopReasonsLabel: 'Lý do dừng tìm hiểu',
  stopNoteLabel: 'Ghi chú thêm',
  noStopNote: 'Không có ghi chú thêm.',
  profileMatches: {
    FULL_MATCH: '100% khớp',
    MOSTLY_MATCH: 'Khá tương đồng',
    DIFFERENT: 'Có khác biệt',
  } as const satisfies Record<FeedbackProfileMatchName, string>,
  feelings: {
    DEEP_INTEREST: 'Rất muốn tìm hiểu sâu hơn',
    NEED_MORE_TIME: 'Cần thêm thời gian quan sát',
    NOT_A_FIT: 'Cảm thấy chưa phù hợp',
  } as const satisfies Record<FeedbackFeelingName, string>,
  decisions: {
    A_COMMIT: 'Tiến tới gắn kết',
    B_STOP: 'Dừng tìm hiểu',
  } as const satisfies Record<FeedbackDecisionName, string>,
  stopReasons: {
    LIFESTYLE_DIFFERENCE: 'Khác biệt lối sống & thói quen',
    NO_SPARK: 'Chưa có rung động',
    FINANCE_FAMILY_PLAN_DIFFERENCE: 'Kế hoạch tài chính / gia đình',
  } as const satisfies Record<FeedbackStopReasonName, string>,
} as const;

export const REFUNDS_COPY = {
  title: 'Hoàn tiền',
  subtitle: 'Yêu cầu hoàn tiền xác thực thủ công cho người dùng (quyền billing:refund).',
  formTitle: 'Yêu cầu hoàn tiền thủ công',
  paymentIdLabel: 'Mã thanh toán (UUID)',
  paymentIdPlaceholder: 'Nhập UUID khoản thanh toán (vd: 01890a5d-ac96-774b-bcce-b302099a8057)',
  paymentIdRequired: 'Vui lòng nhập mã thanh toán.',
  paymentIdInvalid: 'Mã thanh toán không đúng định dạng UUID.',
  reasonLabel: 'Lý do hoàn tiền (bắt buộc)',
  reasonPlaceholder: 'Nhập lý do hoàn tiền để ghi nhật ký kiểm toán (tối đa 500 ký tự)...',
  reasonRequired: 'Vui lòng nhập lý do hoàn tiền.',
  reasonTooLong: (max: number) => `Lý do không được vượt quá ${max} ký tự.`,
  continueBtn: 'Tiếp tục',
  modalTitle: 'Xác nhận hoàn tiền',
  modalDescription: 'Vui lòng kiểm tra kỹ thông tin trước khi xác nhận chuyển xử lý hoàn tiền.',
  confirmCheckbox: 'Tôi xác nhận hoàn tiền cho thanh toán này',
  confirmBtn: 'Xác nhận hoàn tiền',
  cancelBtn: 'Huỷ',
  successTitle: 'Yêu cầu hoàn tiền đã được ghi nhận',
  statusLabel: 'Trạng thái',
  statusProcessed: 'Đã chuyển xử lý hoàn tiền',
  requestedAtLabel: 'Thời điểm yêu cầu',
  voucherVoidedLabel: 'Trạng thái voucher',
  voucherVoidedYes: 'Đã huỷ voucher kèm theo',
  voucherVoidedNo: 'Không có voucher bị huỷ',
  createAnotherBtn: 'Tạo yêu cầu hoàn tiền khác',
} as const;

export const RECONCILIATION_COPY = {
  title: 'Đối soát',
  subtitle: 'Báo cáo đối soát số dư sổ cái và trạng thái thực tế của hệ thống.',
  filterLabel: 'Lọc trạng thái',
  filterAll: 'Tất cả',
  filterMatched: 'Khớp',
  filterMismatch: 'Lệch',
  loadMore: 'Tải thêm báo cáo',
  empty: 'Không có báo cáo đối soát nào',
  emptyDescription: 'Hiện không có báo cáo đối soát nào phù hợp với bộ lọc.',
  tableReportDate: 'Ngày báo cáo',
  tableRunAt: 'Thời điểm chạy',
  tableStatus: 'Trạng thái',
  tableLedgerCharge: 'Tổng thu',
  tableLedgerRefund: 'Tổng hoàn',
  tableHeldPayment: 'Đang giữ',
  tableHeldCount: 'Số khoản giữ',
  tableVouchers: 'Số lượng voucher',
  tableMismatches: 'Chi tiết lệch',
  checkLabels: {
    MONEY_BALANCE: 'Số dư tiền',
    VOUCHER_ISSUE_COUNT: 'Số voucher phát hành',
    VOUCHER_REDEEM_COUNT: 'Số voucher đã sử dụng',
    VOUCHER_VOID_COUNT: 'Số voucher bị huỷ',
  } as const satisfies Record<ReconciliationCheckValue, string>,
  statusLabels: {
    MATCHED: 'Khớp',
    MISMATCH: 'Lệch',
  } as const satisfies Record<ReconciliationStatusValue, string>,
  voucherStatusLabels: {
    RESERVED: 'Đang giữ',
    ACTIVE: 'Khả dụng',
    REDEEMED: 'Đã dùng',
    VOID: 'Đã huỷ',
    EXPIRED: 'Hết hạn',
  } as const satisfies Record<VoucherStatusDto, string>,
  mismatchCheck: 'Hạng mục kiểm tra',
  mismatchLedger: 'Sổ cái',
  mismatchState: 'Thực tế',
  mismatchDifference: 'Chênh lệch',
  noMismatches: 'Không ghi nhận chênh lệch.',
} as const;
