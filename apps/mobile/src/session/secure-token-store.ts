import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from '@tamgiao/api-client';
import type { AuthTokens } from '@tamgiao/contracts/identity';

const ACCESS_TOKEN_KEY = 'tg.accessToken';
const REFRESH_TOKEN_KEY = 'tg.refreshToken';

/**
 * Adapter lưu trữ token bảo mật trên mobile qua expo-secure-store.
 * Tuân thủ luật F4: chỉ lưu trữ accessToken và refreshToken, không lưu bất kỳ PII nào khác.
 */
export function createSecureTokenStore(): TokenStore {
  return {
    async getAccessToken(): Promise<string | null> {
      return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    },

    async getRefreshToken(): Promise<string | null> {
      return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    },

    async setTokens(tokens: AuthTokens): Promise<void> {
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
      ]);
    },

    async clear(): Promise<void> {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
        SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      ]);
    },
  };
}
