const viVnNumberFormatter = new Intl.NumberFormat('vi-VN');

/**
 * Định dạng chuỗi số nguyên VND sang chuỗi tiền tệ tiếng Việt bằng BigInt + Intl.NumberFormat('vi-VN').
 * Dùng BigInt để không mất độ chính xác khi số lớn vượt quá Number.MAX_SAFE_INTEGER (vd: '9007199254740993').
 *
 * @param value Chuỗi số nguyên biểu diễn số tiền VND (có thể âm, 0 hoặc dương).
 * @returns Chuỗi định dạng (vd: '100.000 ₫', '-50.000 ₫', '0 ₫') hoặc trả nguyên chuỗi nếu không phải số nguyên.
 */
export function formatVndBigInt(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !/^-?\d+$/.test(trimmed)) {
    return value;
  }
  try {
    const bigintValue = BigInt(trimmed);
    return `${viVnNumberFormatter.format(bigintValue)} ₫`;
  } catch {
    return value;
  }
}

/**
 * Chuyển ngày báo cáo từ định dạng YYYY-MM-DD sang DD/MM/YYYY bằng cắt chuỗi trực tiếp,
 * không qua `new Date()` để tránh sai lệch múi giờ (BE-S4-07).
 */
export function formatReportDateString(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}
