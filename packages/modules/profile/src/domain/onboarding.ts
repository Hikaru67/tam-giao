import type { ProfileStatus } from './profile.js';

export const ONBOARDING_STEPS = ['PROFILE', 'CRITERIA', 'VERIFICATION', 'UNDER_REVIEW', 'ACTIVE'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Bước onboarding hiện tại (BE-S2-08). Thứ tự: hồ sơ → tiêu chí → xác thực → chờ duyệt → hoạt động.
 * TODO(BE-S3-07, BE-S4-03): khi có facade verification/billing, thay `VERIFICATION` bằng bước thật
 * (`UNDER_REVIEW` khi đã nộp eKYC + thanh toán, `ACTIVE` khi được duyệt).
 */
export function onboardingStep(input: {
  readonly profileStatus: ProfileStatus | null;
  readonly hasPreferences: boolean;
}): OnboardingStep {
  if (input.profileStatus !== 'COMPLETED') return 'PROFILE';
  if (!input.hasPreferences) return 'CRITERIA';
  return 'VERIFICATION';
}
