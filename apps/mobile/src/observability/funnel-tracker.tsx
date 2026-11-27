import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import {
  createFunnelTracker,
  type FunnelStep,
  type FunnelTracker as Tracker,
  type OnboardingStep,
} from '@tamgiao/observability-fe';
import { sessionEvents } from '../session/api.js';

const ONBOARDING_STEPS = [
  'PROFILE',
  'CRITERIA',
  'VERIFICATION',
  'UNDER_REVIEW',
  'REJECTED',
  'ACTIVE',
] as const satisfies readonly OnboardingStep[];

function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && ONBOARDING_STEPS.some((step) => step === value);
}

export interface FunnelTrackerProps {
  track: (step: FunnelStep) => void;
}

/**
 * Theo dõi funnel onboarding (không định danh): đường dẫn màn (OTP → '/', thanh toán → eKYC) và bước onboarding
 * trong dữ liệu `['me']` mỗi lần query thành công. Không đọc/ghi gì khác của người dùng.
 */
export function FunnelTracker({ track }: FunnelTrackerProps): null {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const trackerRef = useRef<Tracker | null>(null);

  function getTracker(): Tracker {
    trackerRef.current ??= createFunnelTracker(track);
    return trackerRef.current;
  }

  useEffect(() => {
    getTracker().onPathChange(pathname);
  }, [pathname]);

  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        event.query.queryKey.length === 1 &&
        event.query.queryKey[0] === 'me'
      ) {
        const data: unknown = event.query.state.data;
        if (typeof data === 'object' && data !== null && 'onboardingStep' in data) {
          const stepValue: unknown = data.onboardingStep;
          if (isOnboardingStep(stepValue)) {
            getTracker().onOnboardingStep(stepValue);
          }
        }
      }
    });
  }, [queryClient]);

  useEffect(() => sessionEvents.onSignedOut(() => getTracker().reset()), []);

  return null;
}
