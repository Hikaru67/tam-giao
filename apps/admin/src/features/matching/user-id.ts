/** UUID chữ thường — đúng dạng BE nhận. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Bỏ khoảng trắng và đưa về chữ thường để so khớp id trong response BE. */
export function normalizeUserId(value: string): string {
  return value.trim().toLowerCase();
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
