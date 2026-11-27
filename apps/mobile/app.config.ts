import type { ExpoConfig } from 'expo/config';

/** `expo export` / build phát hành chạy với NODE_ENV=production → bắt buộc có URL thật, không rơi về máy dev (FE-S6-03). */
const isProductionBuild = process.env.NODE_ENV === 'production';

function publicUrl(name: 'EXPO_PUBLIC_API_URL' | 'EXPO_PUBLIC_WS_URL', devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProductionBuild) {
    throw new Error(`${name} bắt buộc khi build production (FE-S6-03): không dùng URL máy dev.`);
  }
  return devDefault;
}

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
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Tâm Giao chỉ dùng vị trí khi bạn bật gửi vị trí lúc check-in buổi hẹn.',
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiUrl: publicUrl('EXPO_PUBLIC_API_URL', 'http://localhost:3000'),
    wsUrl: publicUrl('EXPO_PUBLIC_WS_URL', 'ws://localhost:3000/ws'),
  },
};

export default config;
