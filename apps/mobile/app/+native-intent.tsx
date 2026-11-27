import { resolveDeepLink } from '../src/features/deep-link/resolve-deep-link';

/**
 * expo-router gọi hàm này cho mọi URL hệ thống (mở app từ link, kể cả lúc khởi động lạnh) trước khi điều hướng (FE-S6-03).
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return resolveDeepLink(path);
}
