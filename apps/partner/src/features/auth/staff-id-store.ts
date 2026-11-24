import { browserLocalStorage, type LocalStorageLike } from './device-id';

export const STAFF_ID_STORAGE_KEY = 'tamgiao.partner.staff_id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidStaffId(id: string): boolean {
  return UUID_PATTERN.test(id.trim());
}

export function normalizeStaffId(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * Nhớ staffId ở localStorage để lần sau nhân viên chỉ cần nhập PIN (mã nhân viên không phải PII).
 */
export function getRememberedStaffId(
  storage: LocalStorageLike | null = browserLocalStorage(),
): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STAFF_ID_STORAGE_KEY);
    if (!raw) return null;
    const normalized = normalizeStaffId(raw);
    return isValidStaffId(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export function setRememberedStaffId(
  staffId: string,
  storage: LocalStorageLike | null = browserLocalStorage(),
): void {
  if (!storage) return;
  const normalized = normalizeStaffId(staffId);
  if (!isValidStaffId(normalized)) return;
  try {
    storage.setItem(STAFF_ID_STORAGE_KEY, normalized);
  } catch {
    // Bỏ qua lỗi lưu storage
  }
}

export function clearRememberedStaffId(storage: LocalStorageLike | null = browserLocalStorage()): void {
  if (!storage) return;
  try {
    if ('removeItem' in storage && typeof (storage as Storage).removeItem === 'function') {
      (storage as Storage).removeItem(STAFF_ID_STORAGE_KEY);
    } else {
      storage.setItem(STAFF_ID_STORAGE_KEY, '');
    }
  } catch {
    // Bỏ qua lỗi xoá storage
  }
}
