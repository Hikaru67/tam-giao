import type { AuthTokens } from '@tamgiao/contracts/identity';

/**
 * Interface cho adapter lưu trữ token xác thực (SecureStore trên mobile, bộ nhớ phiên trên web admin/partner).
 */
export interface TokenStore {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(tokens: AuthTokens): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Tạo adapter lưu trữ token trong bộ nhớ tạm (phục vụ admin, partner hoặc môi trường kiểm thử).
 */
export function createMemoryTokenStore(): TokenStore {
  let storedTokens: AuthTokens | null = null;

  return {
    async getAccessToken(): Promise<string | null> {
      return storedTokens ? storedTokens.accessToken : null;
    },
    async getRefreshToken(): Promise<string | null> {
      return storedTokens ? storedTokens.refreshToken : null;
    },
    async setTokens(tokens: AuthTokens): Promise<void> {
      storedTokens = tokens;
    },
    async clear(): Promise<void> {
      storedTokens = null;
    },
  };
}
