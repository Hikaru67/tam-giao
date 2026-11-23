import type { AuthTokens } from '@tamgiao/contracts/identity';
import type { TokenStore } from '@tamgiao/api-client';

/**
 * Kho token phiên admin. BE cấp một token phiên (Bearer, 8h / 12h khi "ghi nhớ thiết bị"), không có refresh token
 * → `getRefreshToken()` luôn `null`: api-client gặp 401 sẽ xoá token và gọi `onSignedOut` thay vì làm mới.
 * Lưu ở `sessionStorage` (luật F4: bộ nhớ phiên, mất khi đóng tab) — chỉ lưu token, không lưu PII.
 */
export interface AdminTokenStore extends TokenStore {
  setAdminToken(token: string): Promise<void>;
}

export const ADMIN_TOKEN_STORAGE_KEY = 'tamgiao.admin.session';

/** Storage tối thiểu cần dùng — `sessionStorage` của trình duyệt, hoặc `null` khi không truy cập được. */
export type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function readStorage(storage: SessionStorageLike | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Tạo kho token: giữ bản trong bộ nhớ + đồng bộ `storage` (nếu có) để tải lại trang không mất phiên.
 * Storage lỗi (chế độ riêng tư, bị chặn) → vẫn chạy bằng bộ nhớ.
 */
export function createAdminTokenStore(storage: SessionStorageLike | null): AdminTokenStore {
  let token: string | null = readStorage(storage);

  function persist(next: string | null): void {
    token = next;
    if (!storage) return;
    try {
      if (next === null) storage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      else storage.setItem(ADMIN_TOKEN_STORAGE_KEY, next);
    } catch {
      // Bỏ qua: token vẫn còn trong bộ nhớ cho tới khi tải lại trang.
    }
  }

  return {
    async getAccessToken() {
      return token;
    },
    async getRefreshToken() {
      return null;
    },
    async setTokens(tokens: AuthTokens) {
      persist(tokens.accessToken);
    },
    async setAdminToken(next: string) {
      persist(next);
    },
    async clear() {
      persist(null);
    },
  };
}

/** `window.sessionStorage` nếu truy cập được, ngược lại `null`. */
export function browserSessionStorage(): SessionStorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
