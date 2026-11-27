import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra;

const apiUrl = extra?.apiUrl;
if (typeof apiUrl !== 'string' || !apiUrl) {
  throw new Error('MOBILE_ENV: apiUrl bị thiếu hoặc không phải string');
}

const wsUrl = extra?.wsUrl;
if (typeof wsUrl !== 'string' || !wsUrl) {
  throw new Error('MOBILE_ENV: wsUrl bị thiếu hoặc không phải string');
}

/** DSN Sentry tuỳ chọn (FE-S6-04) — để trống = tắt giám sát lỗi. Không qua app.config để không cần plugin native. */
const sentryDsn: string | undefined = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const MOBILE_ENV = {
  apiUrl,
  wsUrl,
  sentryDsn,
};
