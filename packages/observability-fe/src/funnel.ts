import type { ONBOARDING_STEPS } from '@tamgiao/contracts/profile';

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const FUNNEL_STEPS = [
  'signed_in',
  'profile_completed',
  'preferences_completed',
  'payment_completed',
  'ekyc_submitted',
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface FunnelTracker {
  onPathChange(pathname: string): void;
  onOnboardingStep(step: OnboardingStep): void;
  reset(): void;
}

/** Thứ bậc các bước onboarding để phát hiện chuyển bước tiến lên không trùng lặp. */
const ONBOARDING_RANK = {
  PROFILE: 0,
  CRITERIA: 1,
  VERIFICATION: 2,
  UNDER_REVIEW: 3,
  REJECTED: 3,
  ACTIVE: 4,
} as const satisfies Record<OnboardingStep, number>;

/**
 * Tạo bộ theo dõi funnel onboarding không định danh (chỉ phát sự kiện tên bước tối đa 1 lần mỗi phiên).
 */
export function createFunnelTracker(track: (step: FunnelStep) => void): FunnelTracker {
  let lastPath: string | undefined;
  let lastStep: OnboardingStep | undefined;
  const emitted = new Set<FunnelStep>();

  const emit = (step: FunnelStep): void => {
    if (emitted.has(step)) {
      return;
    }
    emitted.add(step);
    track(step);
  };

  return {
    onPathChange: (pathname: string): void => {
      const prev = lastPath;
      lastPath = pathname;

      // Màn OTP chỉ điều hướng replace sang '/' sau khi xác thực thành công.
      if (prev === '/otp' && pathname === '/') {
        emit('signed_in');
      } else if (prev === '/payment' && pathname === '/kyc') {
        // Nút chuyển sang '/kyc' từ màn thanh toán chỉ mở khi giao dịch đã thành công.
        emit('payment_completed');
      }
    },

    onOnboardingStep: (step: OnboardingStep): void => {
      const prev = lastStep;
      lastStep = step;

      // Lần đầu quan sát chưa xác định được trạng thái mới hoàn thành hay có từ phiên trước.
      if (prev === undefined) {
        return;
      }

      const prevRank = ONBOARDING_RANK[prev];
      const nextRank = ONBOARDING_RANK[step];

      if (prevRank < 1 && nextRank >= 1) {
        emit('profile_completed');
      }
      if (prevRank < 2 && nextRank >= 2) {
        emit('preferences_completed');
      }
      if (prevRank < 3 && nextRank >= 3) {
        emit('ekyc_submitted');
      }
    },

    reset: (): void => {
      emitted.clear();
      lastPath = undefined;
      lastStep = undefined;
    },
  };
}
