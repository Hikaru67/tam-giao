/**
 * Chuẩn hoá số điện thoại di động Việt Nam về định dạng E.164 (+84...).
 * Nhận diện các đầu số: 09..., 9..., +849..., 849..., có dấu cách / dấu chấm / dấu gạch ngang.
 * Số di động VN có 9 chữ số sau mã quốc gia và bắt đầu bằng 3, 5, 7, 8, 9.
 * Trả về null nếu không hợp lệ.
 */
export function normalizeVnPhone(input: string): string | null {
  if (!input) {
    return null;
  }

  // Loại bỏ các ký tự phân tách phổ biến
  const cleaned = input.trim().replace(/[\s.\-()]/g, '');

  let nationalDigits = '';

  if (cleaned.startsWith('+84')) {
    nationalDigits = cleaned.slice(3);
  } else if (cleaned.startsWith('84')) {
    nationalDigits = cleaned.slice(2);
  } else if (cleaned.startsWith('0')) {
    nationalDigits = cleaned.slice(1);
  } else if (cleaned.length === 9) {
    nationalDigits = cleaned;
  } else {
    return null;
  }

  // Số di động VN có đúng 9 chữ số và bắt đầu bằng 3, 5, 7, 8, 9
  const vnMobilePattern = /^[35789]\d{8}$/;
  if (!vnMobilePattern.test(nationalDigits)) {
    return null;
  }

  return `+84${nationalDigits}`;
}

/**
 * Định dạng số điện thoại hiển thị thân thiện: "0912 345 678".
 */
export function formatVnPhoneDisplay(e164OrRaw: string): string {
  const normalized = normalizeVnPhone(e164OrRaw);
  if (!normalized) {
    return e164OrRaw;
  }

  // e164: +84XXXXXXXXX (9 chữ số)
  const digits = normalized.slice(3);
  const p1 = `0${digits.slice(0, 3)}`;
  const p2 = digits.slice(3, 6);
  const p3 = digits.slice(6, 9);

  return `${p1} ${p2} ${p3}`;
}
