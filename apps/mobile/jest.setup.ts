// Thiết lập chung cho jest (FE-S2-01): dưới jest, expo-constants không có `extra` từ app.config.ts →
// cấp URL giả để `MOBILE_ENV` (src/env.ts) không throw khi module được nạp.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'http://api.test', wsUrl: 'ws://api.test/ws' } } },
}));
