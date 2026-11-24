import * as Location from 'expo-location';

export const LOCATION_TIMEOUT_MS = 10_000;

export interface CheckInLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters?: number;
}

export async function getOneShotLocation(): Promise<CheckInLocation | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      return null;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        resolve(null);
      }, LOCATION_TIMEOUT_MS);
    });

    const positionPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }).catch(() => null);

    const position = await Promise.race([positionPromise, timeoutPromise]);
    if (timer !== null) {
      clearTimeout(timer);
    }

    if (!position || !position.coords) {
      return null;
    }

    const { latitude, longitude, accuracy } = position.coords;
    const hasValidAccuracy =
      typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100_000;

    return {
      latitude,
      longitude,
      ...(hasValidAccuracy ? { accuracyMeters: accuracy } : {}),
    };
  } catch {
    return null;
  }
}
