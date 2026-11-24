import { createUuidV4 } from '@tamgiao/api-client/ws';

export const DEVICE_ID_STORAGE_KEY = 'tamgiao.partner.device';

/**
 * Định danh thiết bị do web quán sinh và lưu cục bộ (BE-S4-06):
 * Độ dài 8-128 ký tự, chỉ gồm A-Za-z0-9._:-
 */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem'>;

let memoryDeviceId: string | null = null;

export function browserLocalStorage(): LocalStorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isValidDeviceId(id: string): boolean {
  return DEVICE_ID_PATTERN.test(id);
}

/**
 * Lấy hoặc sinh mới mã thiết bị ổn định trên trình duyệt hiện tại.
 * Nếu localStorage gặp lỗi (chế độ ẩn danh, bảo mật trình duyệt), giữ trong bộ nhớ.
 */
export function getOrCreateDeviceId(storage: LocalStorageLike | null = browserLocalStorage()): string {
  if (memoryDeviceId && isValidDeviceId(memoryDeviceId)) {
    return memoryDeviceId;
  }

  if (storage) {
    try {
      const stored = storage.getItem(DEVICE_ID_STORAGE_KEY);
      if (stored && isValidDeviceId(stored)) {
        memoryDeviceId = stored;
        return stored;
      }
    } catch {
      // Bỏ qua lỗi storage
    }
  }

  const generated = createUuidV4();
  memoryDeviceId = generated;

  if (storage) {
    try {
      storage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    } catch {
      // Lưu storage thất bại → giữ bộ nhớ
    }
  }

  return generated;
}

export function resetDeviceIdMemoryForTesting(): void {
  memoryDeviceId = null;
}
