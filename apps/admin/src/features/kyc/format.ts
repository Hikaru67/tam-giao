const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
});

/**
 * Định dạng thời gian theo chuẩn vi-VN (ngắn).
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return dateTimeFormatter.format(date);
}

/**
 * Chuyển 'YYYY-MM-DD' thành 'DD/MM/YYYY' (không qua Date, cắt chuỗi; chuỗi sai định dạng trả nguyên).
 */
export function formatBirthDate(ymd: string): string {
  const parts = ymd.split('-');
  if (parts.length === 3 && parts[0]?.length === 4 && parts[1]?.length === 2 && parts[2]?.length === 2) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return ymd;
}
