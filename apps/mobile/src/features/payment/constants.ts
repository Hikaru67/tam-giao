/** Chu kỳ hỏi lại trạng thái thanh toán khi đang chờ cổng xác nhận. */
export const PAYMENT_POLL_INTERVAL_MS = 3_000;
/** Ngừng hỏi sau khoảng này → hiện trạng thái "chưa nhận được kết quả" kèm nút kiểm tra lại. */
export const PAYMENT_POLL_TIMEOUT_MS = 120_000;
/** Path deep link quay lại app sau khi thanh toán (khớp PAYMENT_RETURN_URL mặc định của BE `tamgiao://payments/return`). */
export const PAYMENT_RETURN_PATH = 'payments/return';
