/**
 * URL API. Bản build bắt buộc có `VITE_API_URL` (vite.config.ts fail sớm). Mặc định localhost chỉ dùng khi dev/test:
 * `import.meta.env.DEV` bị thay bằng `false` lúc build nên chuỗi localhost bị loại khỏi bundle production (FE-S6-03).
 */
function resolveApiUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return 'http://localhost:3000';
  throw new Error('PARTNER_ENV: thiếu VITE_API_URL ở bản build');
}

export const PARTNER_ENV = {
  apiUrl: resolveApiUrl(),
  /** DSN Sentry tuỳ chọn — để trống = tắt giám sát lỗi. */
  sentryDsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
};
