import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Brightness from 'expo-brightness';

export function useMaxBrightness(active: boolean): void {
  const previousBrightnessRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      if (previousBrightnessRef.current !== null) {
        const toRestore = previousBrightnessRef.current;
        previousBrightnessRef.current = null;
        Brightness.setBrightnessAsync(toRestore).catch(() => {});
      }
      return;
    }

    let isMounted = true;

    const applyMaxBrightness = async () => {
      try {
        const current = await Brightness.getBrightnessAsync();
        if (!isMounted) {
          return;
        }
        if (previousBrightnessRef.current === null) {
          previousBrightnessRef.current = current;
        }
        await Brightness.setBrightnessAsync(1);
      } catch {
        // Lỗi bỏ qua. Không yêu cầu quyền hệ thống.
      }
    };

    void applyMaxBrightness();

    const subscription = AppState.addEventListener('change', (nextState) => {
      // Chỉ chỉnh khi đã biết độ sáng cũ để còn khôi phục.
      const previous = previousBrightnessRef.current;
      if (previous === null) return;
      Brightness.setBrightnessAsync(nextState === 'active' ? 1 : previous).catch(() => {});
    });

    return () => {
      isMounted = false;
      subscription.remove();
      if (previousBrightnessRef.current !== null) {
        const toRestore = previousBrightnessRef.current;
        previousBrightnessRef.current = null;
        Brightness.setBrightnessAsync(toRestore).catch(() => {});
      }
    };
  }, [active]);
}
