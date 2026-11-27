/**
 * Văn bản hiển thị cho công cụ thanh toán giả ở môi trường dev (FE-S6-03).
 * Chỉ được import từ module dev (`dev-fake-payment-panel.tsx`), không import từ code production
 * để Metro loại hoàn toàn khỏi bundle phát hành.
 */
export const DEV_FAKE_PAYMENT_COPY = {
  title: 'Công cụ dev: cổng thanh toán giả',
  succeed: 'Thanh toán giả: thành công',
  fail: 'Thanh toán giả: thất bại',
} as const;
