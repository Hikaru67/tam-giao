export interface ErrorMessage {
  /** Câu chính hiển thị cho người dùng (tiếng Việt, lịch sự, ngắn ≤ 90 ký tự, không lộ chi tiết kỹ thuật/PII). */
  readonly title: string;
  /** Gợi ý hành động (tuỳ chọn), vd "Vui lòng thử lại sau {retryAfterSeconds} giây." */
  readonly action?: string;
}

export const ERROR_MESSAGES: Readonly<Record<string, ErrorMessage>> = {
  // ── common ──
  VALIDATION_FAILED: {
    title: 'Thông tin gửi lên chưa hợp lệ.',
    action: 'Vui lòng kiểm tra lại các trường thông tin và thử lại.',
  },
  UNAUTHENTICATED: {
    title: 'Phiên đăng nhập đã hết hạn hoặc bạn chưa đăng nhập.',
    action: 'Vui lòng đăng nhập lại để tiếp tục.',
  },
  FORBIDDEN: {
    title: 'Bạn không có quyền thực hiện thao tác này.',
    action: 'Vui lòng kiểm tra lại quyền tài khoản hoặc liên hệ hỗ trợ.',
  },
  NOT_FOUND: {
    title: 'Không tìm thấy nội dung bạn yêu cầu.',
    action: 'Vui lòng kiểm tra lại liên kết hoặc thông tin cần tìm.',
  },
  RATE_LIMITED: {
    title: 'Bạn đang thao tác quá nhanh.',
    action: 'Vui lòng thử lại sau {retryAfterSeconds} giây.',
  },
  PAYLOAD_TOO_LARGE: {
    title: 'Dữ liệu gửi lên vượt quá kích thước cho phép.',
    action: 'Vui lòng giảm dung lượng tệp hoặc nội dung và thử lại.',
  },
  INTERNAL_ERROR: {
    title: 'Hệ thống đang gặp sự cố gián đoạn.',
    action: 'Vui lòng thử lại sau ít phút hoặc liên hệ hỗ trợ.',
  },
  INVALID_ID: {
    title: 'Mã định danh không đúng định dạng.',
    action: 'Vui lòng kiểm tra lại liên kết hoặc thử lại.',
  },
  MONEY_INVALID: {
    title: 'Số tiền không hợp lệ.',
    action: 'Vui lòng kiểm tra lại số tiền cần thanh toán.',
  },
  MONEY_NEGATIVE: {
    title: 'Số tiền thanh toán không được nhỏ hơn 0.',
    action: 'Vui lòng nhập số tiền hợp lệ.',
  },

  // ── identity ──
  PHONE_INVALID: {
    title: 'Số điện thoại không đúng định dạng.',
    action: 'Vui lòng nhập số điện thoại Việt Nam hợp lệ (10 chữ số).',
  },
  OTP_INVALID: {
    title: 'Mã xác thực không chính xác.',
    action: 'Vui lòng kiểm tra lại mã OTP trong tin nhắn SMS.',
  },
  OTP_EXPIRED: {
    title: 'Mã xác thực đã hết hạn hiệu lực.',
    action: 'Vui lòng bấm gửi lại để nhận mã xác thực mới.',
  },
  OTP_LOCKED: {
    title: 'Bạn đã nhập sai mã xác thực quá số lần cho phép.',
    action: 'Vui lòng thử lại sau {retryAfterSeconds} giây.',
  },
  TOKEN_EXPIRED: {
    title: 'Phiên đăng nhập của bạn đã hết hạn.',
    action: 'Vui lòng đăng nhập lại để tiếp tục sử dụng.',
  },
  TOKEN_REUSED: {
    title: 'Phiên đăng nhập đã bị thu hồi để bảo vệ an toàn tài khoản.',
    action: 'Vui lòng đăng nhập lại.',
  },
  INVALID_CREDENTIALS: {
    title: 'Thông tin đăng nhập không chính xác.',
    action: 'Vui lòng kiểm tra lại tài khoản, mật khẩu hoặc mã xác thực.',
  },
  MFA_REQUIRED: {
    title: 'Tài khoản yêu cầu xác thực hai lớp (TOTP).',
    action: 'Vui lòng nhập mã từ ứng dụng xác thực của bạn.',
  },
  ADMIN_LOCKED: {
    title: 'Tài khoản quản trị tạm thời bị khoá do đăng nhập sai nhiều lần.',
    action: 'Vui lòng thử lại sau {retryAfterSeconds} giây.',
  },
  PASSWORD_TOO_WEAK: {
    title: 'Mật khẩu chưa đủ độ an toàn.',
    action: 'Vui lòng đặt mật khẩu dài hơn và kết hợp chữ số, ký tự đặc biệt.',
  },
  ADMIN_EMAIL_TAKEN: {
    title: 'Địa chỉ email này đã được sử dụng.',
    action: 'Vui lòng sử dụng một địa chỉ email khác.',
  },
  ACCOUNT_BANNED: {
    title: 'Tài khoản của bạn đã bị khoá vĩnh viễn do vi phạm tiêu chuẩn cộng đồng.',
    action: 'Nếu có thắc mắc, vui lòng liên hệ bộ phận hỗ trợ.',
  },
  AUDIT_ENTRY_INVALID: {
    title: 'Hệ thống không thể ghi nhận nhật ký thao tác.',
    action: 'Vui lòng thử lại sau hoặc thông báo cho quản trị viên.',
  },
  DATA_EXPORT_NOT_READY: {
    title: 'Tệp xuất dữ liệu cá nhân đang được xử lý.',
    action: 'Hệ thống đang chuẩn bị tệp, bạn vui lòng quay lại sau ít phút.',
  },
  DATA_EXPORT_EXPIRED: {
    title: 'Liên kết tải dữ liệu cá nhân đã hết hạn.',
    action: 'Vui lòng gửi lại yêu cầu xuất dữ liệu mới.',
  },
  DATA_EXPORT_LINK_INVALID: {
    title: 'Liên kết tải dữ liệu không hợp lệ.',
    action: 'Vui lòng kiểm tra lại liên kết hoặc tạo yêu cầu xuất mới.',
  },

  // ── uploads ──
  UPLOAD_NOT_OWNED: {
    title: 'Bạn không có quyền sử dụng tệp tải lên này.',
    action: 'Vui lòng tải lại tệp từ thiết bị của bạn.',
  },
  UPLOAD_INVALID: {
    title: 'Tệp tải lên không đúng định dạng hoặc chưa hoàn tất.',
    action: 'Vui lòng kiểm tra lại định dạng tệp và thử lại.',
  },

  // ── profile ──
  AGE_NOT_ELIGIBLE: {
    title: 'Bạn chưa đủ tuổi tham gia nền tảng.',
    action: 'Tâm Giao dành cho thành viên đủ tuổi theo quy định.',
  },
  TOO_MANY_PHOTOS: {
    title: 'Số lượng ảnh hồ sơ vượt quá giới hạn.',
    action: 'Vui lòng chọn tối đa số ảnh theo quy định.',
  },
  PROFILE_INCOMPLETE: {
    title: 'Hồ sơ chưa điền đủ các thông tin bắt buộc.',
    action: 'Vui lòng hoàn thiện các mục còn thiếu để tiếp tục.',
  },
  INVALID_CORE_TRAITS: {
    title: 'Lựa chọn phẩm chất cốt lõi chưa chính xác.',
    action: 'Vui lòng chọn đúng 3 phẩm chất quan trọng nhất với bạn.',
  },

  // ── verification ──
  INVALID_CCCD_NUMBER: {
    title: 'Số căn cước công dân không hợp lệ.',
    action: 'Vui lòng nhập đúng 12 chữ số căn cước của bạn.',
  },
  REJECTION_REASON_REQUIRED: {
    title: 'Cần chọn lý do từ chối hồ sơ xác thực.',
    action: 'Vui lòng chọn một lý do hợp lệ trong danh sách.',
  },
  KYC_MORE_INFO_ITEMS_REQUIRED: {
    title: 'Cần chọn ít nhất một loại giấy tờ cần bổ sung.',
    action: 'Vui lòng đánh dấu tài liệu cần người dùng nộp thêm.',
  },
  KYC_INVALID_TRANSITION: {
    title: 'Trạng thái hồ sơ xác thực hiện tại không phù hợp với thao tác.',
    action: 'Vui lòng làm mới trang để xem trạng thái mới nhất.',
  },
  KYC_STEPS_INCOMPLETE: {
    title: 'Hồ sơ chưa hoàn thành đủ các bước xác minh.',
    action: 'Vui lòng kiểm tra và duyệt đủ 4 bước trước khi phê duyệt.',
  },
  KYC_ALREADY_DECIDED: {
    title: 'Hồ sơ xác thực này đã có kết quả trước đó.',
    action: 'Bạn không thể thay đổi kết quả đã được phê duyệt hoặc từ chối.',
  },
  CCCD_ALREADY_REGISTERED: {
    title: 'Số căn cước này đã được liên kết với một tài khoản khác.',
    action: 'Mỗi căn cước chỉ dùng cho một tài khoản duy nhất.',
  },
  KYC_ALREADY_SUBMITTED: {
    title: 'Hồ sơ xác thực của bạn đã được gửi trước đó.',
    action: 'Hệ thống đang tiến hành xử lý, bạn không cần gửi lại.',
  },
  KYC_DOCS_MISSING: {
    title: 'Hồ sơ còn thiếu giấy tờ xác thực bắt buộc.',
    action: 'Vui lòng tải lên đầy đủ giấy tờ được yêu cầu.',
  },
  KYC_SUBMISSION_NOT_FOUND: {
    title: 'Không tìm thấy thông tin hồ sơ xác thực.',
    action: 'Vui lòng kiểm tra lại mã hồ sơ hoặc danh sách chờ.',
  },
  KYC_CCCD_NUMBER_MISSING: {
    title: 'Chưa nhận diện được số căn cước trên ảnh.',
    action: 'Vui lòng tải lại ảnh căn cước rõ nét và không bị loá.',
  },
  SLOT_TAKEN: {
    title: 'Khung giờ phỏng vấn này vừa có người đặt.',
    action: 'Vui lòng chọn một khung giờ phỏng vấn khác còn trống.',
  },
  CANCEL_TOO_LATE: {
    title: 'Đã quá thời hạn cho phép huỷ hoặc đổi lịch phỏng vấn.',
    action: 'Vui lòng tham gia đúng giờ hoặc liên hệ chuyên viên hỗ trợ.',
  },
  INTERVIEW_SLOT_IN_PAST: {
    title: 'Khung giờ phỏng vấn được chọn đã trôi qua.',
    action: 'Vui lòng chọn một khung giờ trong tương lai.',
  },
  INTERVIEW_SLOT_NOT_FOUND: {
    title: 'Không tìm thấy khung giờ phỏng vấn yêu cầu.',
    action: 'Khung giờ này có thể đã được cập nhật, vui lòng tải lại danh sách.',
  },
  INTERVIEW_SLOT_OVERLAP: {
    title: 'Khung giờ này bị trùng với lịch phỏng vấn khác.',
    action: 'Vui lòng chọn một khoảng thời gian không bị chồng chéo.',
  },
  INTERVIEW_NOT_BOOKED: {
    title: 'Bạn chưa có lịch hẹn phỏng vấn nào đang hoạt động.',
    action: 'Vui lòng đặt một khung giờ phỏng vấn mới.',
  },
  INTERVIEW_NOT_STARTED: {
    title: 'Buổi phỏng vấn chưa đến giờ bắt đầu.',
    action: 'Vui lòng quay lại đúng khung giờ đã hẹn.',
  },
  INTERVIEW_ALREADY_BOOKED: {
    title: 'Bạn đã có một lịch phỏng vấn đang chờ diễn ra.',
    action: 'Vui lòng hoàn thành buổi hẹn hiện tại hoặc đổi sang khung giờ khác.',
  },
  INTERVIEW_ALREADY_PASSED: {
    title: 'Bạn đã hoàn thành bước phỏng vấn sơ bộ.',
    action: 'Không cần đặt thêm lịch phỏng vấn mới.',
  },
  INTERVIEW_REQUIRES_SUBMISSION: {
    title: 'Cần gửi hồ sơ xác thực trước khi đặt lịch phỏng vấn.',
    action: 'Vui lòng nộp hồ sơ xác thực để tiếp tục đặt lịch.',
  },

  // ── billing ──
  PAYMENT_INVALID_TRANSITION: {
    title: 'Thao tác không phù hợp với trạng thái thanh toán hiện tại.',
    action: 'Vui lòng kiểm tra lại lịch sử thanh toán của bạn.',
  },
  PAYMENT_NOT_REFUNDABLE: {
    title: 'Khoản thanh toán chưa thành công nên không thể hoàn tiền.',
    action: 'Chỉ các giao dịch đã thu phí thành công mới có thể hoàn trả.',
  },
  PAYMENT_ALREADY_REFUNDED: {
    title: 'Khoản thanh toán này đã được hoàn trả trước đó.',
    action: 'Vui lòng kiểm tra tài khoản ngân hàng hoặc lịch sử giao dịch.',
  },
  LEDGER_AMOUNT_INVALID: {
    title: 'Số tiền ghi nhận sổ cái không hợp lệ.',
    action: 'Số tiền phải là số dương lớn hơn 0.',
  },
  LEDGER_REFERENCE_REQUIRED: {
    title: 'Bút toán sổ cái thiếu thông tin đối chiếu bắt buộc.',
    action: 'Vui lòng cung cấp mã tham chiếu giao dịch hoặc voucher.',
  },
  VOUCHER_INVALID_TRANSITION: {
    title: 'Trạng thái voucher không cho phép thực hiện thao tác này.',
    action: 'Vui lòng làm mới danh sách voucher để kiểm tra.',
  },
  VOUCHER_NOT_ACTIVE: {
    title: 'Voucher chưa sẵn sàng sử dụng hoặc đã bị huỷ.',
    action: 'Vui lòng kiểm tra lại điều kiện kích hoạt của voucher.',
  },
  VOUCHER_ALREADY_REDEEMED: {
    title: 'Voucher này đã được áp dụng trước đó.',
    action: 'Mỗi voucher chỉ có giá trị sử dụng một lần duy nhất.',
  },
  VOUCHER_EXPIRED: {
    title: 'Voucher đã hết thời hạn sử dụng.',
    action: 'Vui lòng sử dụng voucher khác còn hiệu lực.',
  },
  VOUCHER_PARTNER_MISMATCH: {
    title: 'Voucher không áp dụng tại địa điểm này.',
    action: 'Vui lòng kiểm tra danh sách quán đối tác áp dụng voucher.',
  },
  PAYMENT_REQUIRED: {
    title: 'Bạn cần thanh toán phí xác thực để tiếp tục.',
    action: 'Vui lòng hoàn tất thanh toán để mở khoá bước tiếp theo.',
  },
  PAYMENT_ALREADY_EXISTS: {
    title: 'Bạn đã hoàn tất thanh toán phí xác thực.',
    action: 'Không cần thanh toán thêm, bạn có thể tiếp tục các bước kế tiếp.',
  },
  WEBHOOK_INVALID: {
    title: 'Thông tin xác thực thanh toán không hợp lệ.',
    action: 'Yêu cầu không được hệ thống chấp nhận.',
  },
  PAYMENT_GATEWAY_UNAVAILABLE: {
    title: 'Cổng thanh toán đang tạm thời gián đoạn.',
    action: 'Vui lòng thử lại sau ít phút.',
  },
  PAYMENT_NOT_FOUND: {
    title: 'Không tìm thấy thông tin giao dịch thanh toán.',
    action: 'Vui lòng kiểm tra lại mã giao dịch hoặc liên hệ hỗ trợ.',
  },
  PARTNER_NOT_FOUND: {
    title: 'Không tìm thấy thông tin quán đối tác.',
    action: 'Vui lòng chọn địa điểm từ danh sách đối tác chính thức.',
  },
  PARTNER_STAFF_NOT_FOUND: {
    title: 'Không tìm thấy tài khoản nhân viên quán.',
    action: 'Vui lòng kiểm tra lại mã nhân viên của bạn.',
  },
  PARTNER_INVALID: {
    title: 'Thông tin quán đối tác chưa chính xác.',
    action: 'Vui lòng kiểm tra tên, địa chỉ và thông tin liên hệ.',
  },
  PARTNER_PIN_INVALID: {
    title: 'Mã PIN nhân viên không hợp lệ.',
    action: 'Mã PIN phải bao gồm đúng 6 chữ số.',
  },
  PARTNER_LOGIN_FAILED: {
    title: 'Đăng nhập nhân viên không thành công.',
    action: 'Vui lòng kiểm tra lại mã nhân viên, PIN hoặc thiết bị đăng nhập.',
  },
  PARTNER_STAFF_LOCKED: {
    title: 'Tài khoản nhân viên tạm thời bị khoá do nhập sai nhiều lần.',
    action: 'Vui lòng thử lại sau {retryAfterSeconds} giây.',
  },
  PARTNER_INACTIVE: {
    title: 'Quán hoặc tài khoản nhân viên đã ngừng hoạt động.',
    action: 'Vui lòng liên hệ quản lý đối tác để được hỗ trợ.',
  },
  PARTNER_TOKEN_INVALID: {
    title: 'Phiên làm việc của nhân viên quán đã hết hạn.',
    action: 'Vui lòng đăng nhập lại trên thiết bị đã đăng ký.',
  },
  VOUCHER_NOT_FOUND: {
    title: 'Không tìm thấy thông tin voucher.',
    action: 'Vui lòng kiểm tra lại mã voucher trong hộp quà của bạn.',
  },
  VOUCHER_TOKEN_INVALID: {
    title: 'Mã QR voucher không hợp lệ hoặc đã hết hạn.',
    action: 'Vui lòng mở lại ứng dụng để làm mới mã QR.',
  },

  // ── matching ──
  INVALID_TRANSITION: {
    title: 'Thao tác không phù hợp với giai đoạn kết nối hiện tại.',
    action: 'Vui lòng làm mới màn hình để cập nhật thông tin mới nhất.',
  },
  OFFER_EXPIRED: {
    title: 'Gợi ý này đã hết thời gian phản hồi.',
    action: 'Hệ thống sẽ gửi gợi ý mới cho bạn.',
  },
  NOT_PARTICIPANT: {
    title: 'Bạn không thuộc danh sách kết nối này.',
    action: 'Bạn chỉ có thể thao tác với cuộc trò chuyện và gợi ý của chính mình.',
  },
  NOT_YET_EXPIRED: {
    title: 'Gợi ý kết nối vẫn đang trong thời gian phản hồi.',
    action: 'Vui lòng chờ đối phương phản hồi trước khi kết thúc hạn.',
  },
  ALREADY_RESPONDED: {
    title: 'Bạn đã gửi phản hồi cho gợi ý này rồi.',
    action: 'Vui lòng chờ phản hồi từ phía đối phương.',
  },
  USER_BUSY: {
    title: 'Bạn hoặc đối phương đang trong một kết nối tìm hiểu khác.',
    action: 'Tâm Giao duy trì kết nối độc quyền 1-1 để bảo đảm sự chân thành.',
  },
  USER_COOLING_DOWN: {
    title: 'Tài khoản đang trong giai đoạn nghỉ ngơi sau kết nối.',
    action: 'Bạn sẽ sớm nhận được gợi ý ghép đôi mới khi hết thời gian nghỉ.',
  },
  PAIR_ALREADY_TRIED: {
    title: 'Hai bạn đã từng được gợi ý kết nối trước đây.',
    action: 'Hệ thống sẽ ưu tiên tìm kiếm những người bạn mới phù hợp hơn.',
  },
  MATCH_SAME_USER: {
    title: 'Không thể tạo gợi ý kết nối với chính mình.',
    action: 'Vui lòng chọn hai ứng viên khác nhau.',
  },
  USER_NOT_VERIFIED: {
    title: 'Thành viên chưa hoàn tất quy trình xác thực hồ sơ.',
    action: 'Chỉ những hồ sơ đã được thẩm định mới có thể tham gia ghép đôi.',
  },
  HARD_FILTER_MISMATCH: {
    title: 'Hai hồ sơ chưa tương thích với tiêu chí bắt buộc của nhau.',
    action: 'Hệ thống sẽ tìm những ứng viên phù hợp hơn với tiêu chí của bạn.',
  },
  CANDIDATE_PROFILE_NOT_FOUND: {
    title: 'Chưa đủ thông tin hồ sơ để tìm kiếm người phù hợp.',
    action: 'Vui lòng hoàn thiện hồ sơ và tiêu chí bạn đời để bắt đầu.',
  },
  NO_OPEN_MATCH: {
    title: 'Hiện tại bạn không có lời ngỏ ghép đôi nào đang chờ.',
    action: 'Chuyên viên sẽ gửi thông báo khi có gợi ý phù hợp mới.',
  },

  // ── messaging ──
  CONVERSATION_CLOSED: {
    title: 'Cuộc trò chuyện này đã kết thúc.',
    action: 'Bạn không thể gửi thêm tin nhắn vào cuộc trò chuyện đã đóng.',
  },
  MESSAGE_EMPTY: {
    title: 'Nội dung tin nhắn không được để trống.',
    action: 'Vui lòng nhập nội dung tin nhắn trước khi gửi.',
  },
  MESSAGE_TOO_LONG: {
    title: 'Nội dung tin nhắn vượt quá độ dài tối đa.',
    action: 'Vui lòng rút ngắn tin nhắn xuống dưới {maxLength} ký tự.',
  },
  CLIENT_MESSAGE_ID_CONFLICT: {
    title: 'Tin nhắn này đã được gửi trước đó.',
    action: 'Vui lòng làm mới cuộc trò chuyện để xem tin nhắn mới nhất.',
  },
  CONVERSATION_NOT_JOINED: {
    title: 'Bạn chưa kết nối vào cuộc trò chuyện này.',
    action: 'Vui lòng làm mới trang để tham gia lại phòng chat.',
  },

  // ── safety ──
  REPORT_TARGET_INVALID: {
    title: 'Bạn chỉ có thể gửi báo cáo về người từng kết nối với mình.',
    action: 'Không thể tự báo cáo chính mình hoặc người chưa từng ghép đôi.',
  },
  REPORT_DESCRIPTION_TOO_LONG: {
    title: 'Phần mô tả báo cáo vượt quá độ dài quy định.',
    action: 'Vui lòng tóm tắt nội dung dưới {maxLength} ký tự.',
  },
  REPORT_EVIDENCE_TOO_MANY: {
    title: 'Số lượng ảnh bằng chứng vượt quá mức cho phép.',
    action: 'Vui lòng chọn tối đa {max} ảnh đính kèm.',
  },
  REPORT_INVALID_TRANSITION: {
    title: 'Thao tác không phù hợp với tiến độ xử lý báo cáo hiện tại.',
    action: 'Vui lòng làm mới danh sách để theo dõi tiến độ mới nhất.',
  },
  REPORT_NOT_FOUND: {
    title: 'Không tìm thấy báo cáo vi phạm được yêu cầu.',
    action: 'Báo cáo có thể đã được giải quyết hoặc không tồn tại.',
  },
  REPORT_CONCLUSION_INVALID: {
    title: 'Kết luận xử lý báo cáo không hợp lệ.',
    action: 'Vui lòng cung cấp kết luận cụ thể dưới {maxLength} ký tự.',
  },
  BAN_REASON_INVALID: {
    title: 'Lý do khoá tài khoản chưa đúng quy định.',
    action: 'Vui lòng ghi rõ lý do khoá tài khoản dưới {maxLength} ký tự.',
  },
  USER_ALREADY_BANNED: {
    title: 'Tài khoản này đã bị khoá từ trước.',
    action: 'Không cần thực hiện lại thao tác khoá tài khoản.',
  },
  FLAGGED_MESSAGE_NOT_FOUND: {
    title: 'Không tìm thấy tin nhắn bị đánh dấu vi phạm.',
    action: 'Tin nhắn có thể đã được xử lý hoặc gỡ bỏ cảnh báo.',
  },

  // ── dating ──
  MATCH_NOT_DATING: {
    title: 'Chỉ có thể đặt lịch hẹn khi đang trong giai đoạn tìm hiểu.',
    action: 'Vui lòng hoàn tất giai đoạn tìm hiểu trước khi hẹn gặp mặt.',
  },
  DATE_ALREADY_OPEN: {
    title: 'Bạn đã có một lịch hẹn đang chờ diễn ra.',
    action: 'Mỗi cặp đôi chỉ có thể lên một lịch hẹn gặp tại một thời điểm.',
  },
  DATE_TIME_INVALID: {
    title: 'Thời gian hẹn gặp không hợp lệ.',
    action: 'Vui lòng chọn khung giờ trong tương lai với thời lượng hợp lý.',
  },
  DATE_NOT_INVITEE: {
    title: 'Chỉ người nhận lời mời mới có quyền xác nhận lịch hẹn.',
    action: 'Vui lòng chờ đối phương phản hồi lời mời của bạn.',
  },
  DATE_RESPONSE_EXPIRED: {
    title: 'Lời mời hẹn gặp đã quá thời gian xác nhận.',
    action: 'Bạn có thể đề xuất một khung giờ gặp mặt mới.',
  },
  DATE_INVALID_TRANSITION: {
    title: 'Không thể thực hiện thao tác ở trạng thái lịch hẹn hiện tại.',
    action: 'Vui lòng làm mới màn hình để xem thông tin lịch hẹn mới nhất.',
  },
  DATE_CHECK_IN_WINDOW_CLOSED: {
    title: 'Chưa đến hoặc đã qua khung giờ điểm danh an toàn.',
    action: 'Bạn chỉ có thể điểm danh trong khoảng thời gian diễn ra buổi hẹn.',
  },
  DATE_ALREADY_CHECKED_IN: {
    title: 'Bạn đã hoàn tất điểm danh cho buổi hẹn này.',
    action: 'Hệ thống đã ghi nhận sự có mặt an toàn của bạn.',
  },
  DATE_NOT_CHECKED_IN: {
    title: 'Bạn chưa điểm danh hoặc đã kết thúc buổi hẹn.',
    action: 'Vui lòng kiểm tra lại trạng thái điểm danh buổi hẹn của bạn.',
  },
  FEEDBACK_INVALID: {
    title: 'Thông tin đánh giá sau buổi gặp chưa hợp lệ.',
    action: 'Vui lòng kiểm tra lại điểm số và các câu trả lời của bạn.',
  },
  FEEDBACK_NOT_ALLOWED: {
    title: 'Chưa thể gửi đánh giá cho buổi gặp mặt này.',
    action: 'Chỉ có thể đánh giá sau khi buổi hẹn đã diễn ra theo lịch.',
  },
  FEEDBACK_ALREADY_SUBMITTED: {
    title: 'Bạn đã gửi đánh giá cho buổi gặp này rồi.',
    action: 'Mỗi người chỉ gửi một lần đánh giá và không thể chỉnh sửa.',
  },
  FEEDBACK_NOT_FOUND: {
    title: 'Không tìm thấy nội dung đánh giá của buổi gặp.',
    action: 'Vui lòng kiểm tra lại mã lịch hẹn hoặc danh sách đánh giá.',
  },

  // ── client ──
  NETWORK_ERROR: {
    title: 'Không thể kết nối đến máy chủ.',
    action: 'Vui lòng kiểm tra lại kết nối mạng trên thiết bị và thử lại.',
  },
  TIMEOUT: {
    title: 'Thời gian chờ phản hồi từ máy chủ đã quá hạn.',
    action: 'Vui lòng kiểm tra đường truyền mạng và thử lại sau ít giây.',
  },
  RESPONSE_INVALID: {
    title: 'Dữ liệu nhận được từ máy chủ không đúng định dạng.',
    action: 'Vui lòng thử lại hoặc cập nhật ứng dụng lên phiên bản mới nhất.',
  },
  UPLOAD_FAILED: {
    title: 'Quá trình tải tệp lên máy chủ không thành công.',
    action: 'Vui lòng kiểm tra dung lượng tệp và đường truyền mạng rồi thử lại.',
  },
};
