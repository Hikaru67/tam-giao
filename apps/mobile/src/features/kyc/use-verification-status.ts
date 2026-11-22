import { useCallback } from 'react';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  myVouchersResponseSchema,
  partnerListResponseSchema,
  paymentHistoryResponseSchema,
  type MyVouchersResponse,
  type PartnerListResponse,
  type PaymentHistoryResponse,
} from '@tamgiao/contracts/billing';
import type { NotificationKindName } from '@tamgiao/contracts/notification';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useForegroundNotification } from '../notifications/use-foreground-notification.js';
import { PAYMENTS_QUERY_KEY } from '../payment/index.js';
import { KYC_QUERY_KEY } from './use-kyc.js';

export const VOUCHERS_QUERY_KEY = ['vouchers'] as const;
export const PARTNERS_QUERY_KEY = ['partners'] as const;

export function useMyVouchers(): UseQueryResult<MyVouchersResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: VOUCHERS_QUERY_KEY,
    queryFn: () => client.get('/me/vouchers', { schema: myVouchersResponseSchema }),
  });
}

/** Lịch sử thanh toán (`GET /me/payments`, mới nhất trước) — dùng chung cache với màn thanh toán. */
export function usePaymentHistory(): UseQueryResult<PaymentHistoryResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: PAYMENTS_QUERY_KEY,
    queryFn: () => client.get('/me/payments', { schema: paymentHistoryResponseSchema }),
  });
}

/** Quán đối tác đang hoạt động (`GET /partners`) — tên quán dùng voucher, không hardcode. */
export function usePartners(): UseQueryResult<PartnerListResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: PARTNERS_QUERY_KEY,
    queryFn: () => client.get('/partners', { schema: partnerListResponseSchema }),
  });
}

/** Push làm thay đổi trạng thái hồ sơ / voucher / hoàn tiền. */
export const VERIFICATION_STATUS_PUSH_KINDS = [
  'KYC_APPROVED',
  'KYC_REJECTED',
  'REFUND_COMPLETED',
] as const satisfies readonly NotificationKindName[];

/** Query của màn trạng thái cần làm mới khi kéo xuống hoặc khi nhận push. `['me']` đổi bước onboarding khi duyệt. */
const STATUS_QUERY_KEYS = [KYC_QUERY_KEY, VOUCHERS_QUERY_KEY, PAYMENTS_QUERY_KEY, ['me']] as const;

/** Trả hàm làm mới toàn bộ dữ liệu màn trạng thái (invalidate → refetch query đang mở). */
export function useRefreshVerificationStatus(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all(STATUS_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  }, [queryClient]);
}

/** Đang mở màn trạng thái mà nhận push `KYC_APPROVED` / `KYC_REJECTED` / `REFUND_COMPLETED` → tự làm mới. */
export function useVerificationStatusPushRefresh(): void {
  const refresh = useRefreshVerificationStatus();
  useForegroundNotification(VERIFICATION_STATUS_PUSH_KINDS, () => {
    void refresh();
  });
}
