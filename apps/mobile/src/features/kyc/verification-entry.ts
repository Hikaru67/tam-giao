import type { VerificationPaymentStatus } from '@tamgiao/contracts/billing';
import type { KycProgressStatus } from './types.js';

export const VERIFICATION_ROUTES = {
  payment: '/(verification)/payment',
  kyc: '/(verification)/kyc',
  status: '/(verification)/status',
} as const;

export type VerificationRoute = (typeof VERIFICATION_ROUTES)[keyof typeof VERIFICATION_ROUTES];

/**
 * Điểm vào luồng xác thực (`/(verification)/start`):
 * - Hồ sơ đã nộp / đang thẩm định / đã quyết định → màn trạng thái.
 * - Chuyên viên yêu cầu bổ sung → màn eKYC (BE đã kiểm tra thanh toán ở lần nộp đầu).
 * - Chưa nộp: đã thanh toán phí xác thực (`SUCCEEDED`) → màn eKYC; chưa → màn thanh toán.
 */
export function resolveVerificationEntry(
  kycStatus: KycProgressStatus,
  latestPaymentStatus: VerificationPaymentStatus | null,
): VerificationRoute {
  if (kycStatus === 'NEEDS_MORE_INFO') return VERIFICATION_ROUTES.kyc;
  if (kycStatus !== 'NOT_SUBMITTED' && kycStatus !== 'DRAFT') return VERIFICATION_ROUTES.status;
  return latestPaymentStatus === 'SUCCEEDED' ? VERIFICATION_ROUTES.kyc : VERIFICATION_ROUTES.payment;
}
