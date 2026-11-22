import type { ONBOARDING_STEPS } from '@tamgiao/contracts/profile';

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_ROUTES = {
  PROFILE: '/(onboarding)/profile',
  CRITERIA: '/(onboarding)/preferences',
  VERIFICATION: '/(verification)/start',
  UNDER_REVIEW: '/(verification)/status',
  REJECTED: '/(verification)/status',
  ACTIVE: '/(main)/home',
} as const satisfies Record<OnboardingStep, string>;

/**
 * Trả về đường dẫn màn hình tương ứng với bước onboarding của người dùng.
 */
export function routeForOnboarding(step: OnboardingStep): string {
  return ONBOARDING_ROUTES[step];
}
