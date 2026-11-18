import type { ProfileStatus } from './profile.js';

export const ONBOARDING_STEPS = [
  'PROFILE',
  'CRITERIA',
  'VERIFICATION',
  'UNDER_REVIEW',
  'ACTIVE',
  'REJECTED',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Trạng thái xác thực tổng hợp profile cần (cùng giá trị với `VerificationStatus` của facade verification;
 * domain không import facade — A1).
 */
export type VerificationProgress = 'NOT_SUBMITTED' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';

/**
 * Bước onboarding hiện tại (BE-S2-08, BE-S3-07). Thứ tự: hồ sơ → tiêu chí → xác thực → chờ duyệt → hoạt động.
 * - Chưa nộp eKYC → `VERIFICATION`; đã nộp, chưa quyết định (kể cả đang được yêu cầu bổ sung) → `UNDER_REVIEW`;
 *   được duyệt → `ACTIVE`; bị từ chối → `REJECTED`.
 * - Hồ sơ/tiêu chí luôn được xét trước: chưa xong thì vẫn trả `PROFILE`/`CRITERIA` dù trạng thái xác thực ra sao.
 * TODO(BE-S4-03): `UNDER_REVIEW` chỉ khi đã nộp eKYC **và** đã thanh toán (facade billing).
 */
export function onboardingStep(input: {
  readonly profileStatus: ProfileStatus | null;
  readonly hasPreferences: boolean;
  readonly verification: VerificationProgress;
}): OnboardingStep {
  if (input.profileStatus !== 'COMPLETED') return 'PROFILE';
  if (!input.hasPreferences) return 'CRITERIA';
  switch (input.verification) {
    case 'NOT_SUBMITTED':
      return 'VERIFICATION';
    case 'IN_PROGRESS':
      return 'UNDER_REVIEW';
    case 'APPROVED':
      return 'ACTIVE';
    case 'REJECTED':
      return 'REJECTED';
  }
}
