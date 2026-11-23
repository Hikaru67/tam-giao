/**
 * Định dạng số tiền VND (vd: 299000 -> "299.000đ").
 * Dùng regex phân tách hàng nghìn bằng dấu chấm để không phụ thuộc Intl trên Hermes.
 */
export function formatVnd(amount: number): string {
  return `${Math.trunc(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
}
