import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';

/** Khoá chặn chụp màn hình theo màn — mỗi màn một khoá để bật/tắt độc lập (expo-screen-capture đếm theo key). */
export type ScreenCaptureKey = 'kyc' | 'chat' | 'voucher' | 'safety-report' | 'match-profile';

/**
 * Chặn chụp/quay màn hình khi màn đang focus (luật F5: eKYC, chat, ảnh nhạy cảm). Rời màn (blur, đẩy màn khác lên, unmount) → bỏ chặn.
 * Nền tảng không hỗ trợ (web, iOS chỉ che khi quay màn hình) → bỏ qua lỗi, không chặn luồng.
 */
export function useScreenCaptureProtection(key: ScreenCaptureKey): void {
  useFocusEffect(
    useCallback(() => {
      preventScreenCaptureAsync(key).catch(() => undefined);
      return () => {
        allowScreenCaptureAsync(key).catch(() => undefined);
      };
    }, [key]),
  );
}
