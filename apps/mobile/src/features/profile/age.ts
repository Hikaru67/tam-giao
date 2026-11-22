import { MIN_AGE } from '@tamgiao/contracts/constants';

/** Múi giờ Việt Nam (UTC+7, không có giờ mùa hè) — tuổi tính theo ngày lịch tại Việt Nam. */
const VN_OFFSET_MS = 7 * 3_600_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Tính tuổi tròn theo ngày lịch Việt Nam từ chuỗi `YYYY-MM-DD`.
 * Trả về `null` nếu chuỗi không đúng định dạng ngày tháng hợp lệ.
 */
export function calculateAge(birthDate: string, now: Date = new Date()): number | null {
  const m = DATE_PATTERN.exec(birthDate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }

  const today = new Date(now.getTime() + VN_OFFSET_MS);
  const [ty, tm, td] = [today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()];
  let age = ty - y;
  if (tm < mo || (tm === mo && td < d)) age -= 1;
  return age;
}

/**
 * Kiểm tra tuổi có đủ điều kiện tham gia (≥ MIN_AGE).
 */
export function isAgeEligible(birthDate: string, now: Date = new Date()): boolean {
  const age = calculateAge(birthDate, now);
  if (age === null) return false;
  return age >= MIN_AGE;
}
