import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Tâm Giao',
  slug: 'tam-giao',
  scheme: 'tamgiao',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'vn.tamgiao.app',
  },
  android: {
    package: 'vn.tamgiao.app',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-notifications',
    [
      'expo-camera',
      {
        cameraPermission: 'Tâm Giao cần dùng máy ảnh để chụp giấy tờ và ảnh chân dung khi xác thực hồ sơ.',
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
    wsUrl: process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:3000/ws',
  },
};

export default config;
