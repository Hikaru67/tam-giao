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

export const MOBILE_ENV = {
  apiUrl,
  wsUrl,
};
