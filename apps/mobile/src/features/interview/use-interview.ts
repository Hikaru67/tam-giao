import { isApiError } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { PAGE_LIMIT_MAX } from '@tamgiao/contracts/http';
import {
  availableInterviewSlotListResponseSchema,
  myInterviewResponseSchema,
  type AvailableInterviewSlotListResponse,
  type MyInterviewResponse,
} from '@tamgiao/contracts/verification';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

/** Lịch đã đặt. Nằm dưới tiền tố `['kyc']` để làm mới cùng tiến độ xác thực. */
export const MY_INTERVIEW_QUERY_KEY = ['kyc', 'interview'] as const;
export const INTERVIEW_SLOTS_QUERY_KEY = ['kyc', 'interview', 'slots'] as const;

/** Mã lỗi BE khi slot vừa bị người khác lấy (BE-S3-05). */
export const SLOT_TAKEN_CODE = 'SLOT_TAKEN';

export function isSlotTakenError(err: unknown): boolean {
  return isApiError(err) && err.code === SLOT_TAKEN_CODE;
}

export function useMyInterview(): UseQueryResult<MyInterviewResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: MY_INTERVIEW_QUERY_KEY,
    queryFn: () => client.get('/me/kyc/interview', { schema: myInterviewResponseSchema }),
  });
}

/** Slot còn trống từ bây giờ (server lọc theo giờ server), tăng dần theo giờ bắt đầu. */
export function useInterviewSlots(options?: {
  enabled?: boolean;
}): UseQueryResult<AvailableInterviewSlotListResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: INTERVIEW_SLOTS_QUERY_KEY,
    queryFn: () =>
      client.get('/me/kyc/interview/slots', {
        query: { limit: PAGE_LIMIT_MAX },
        schema: availableInterviewSlotListResponseSchema,
      }),
    enabled: options?.enabled ?? true,
  });
}

async function applyBookingResult(queryClient: QueryClient, data: MyInterviewResponse): Promise<void> {
  queryClient.setQueryData(MY_INTERVIEW_QUERY_KEY, data);
  await queryClient.invalidateQueries({ queryKey: INTERVIEW_SLOTS_QUERY_KEY });
}

async function refreshAfterSlotTaken(queryClient: QueryClient, err: Error): Promise<void> {
  // Slot vừa bị người khác lấy → làm mới danh sách để người dùng chọn slot khác.
  if (isSlotTakenError(err)) {
    await queryClient.invalidateQueries({ queryKey: INTERVIEW_SLOTS_QUERY_KEY });
  }
}

/** `POST /me/kyc/interview` — đặt slot. */
export function useBookInterview(): UseMutationResult<MyInterviewResponse, Error, string> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<MyInterviewResponse, Error, string>({
    mutationFn: (slotId) =>
      client.post('/me/kyc/interview', { body: { slotId }, schema: myInterviewResponseSchema }),
    onSuccess: (data) => applyBookingResult(queryClient, data),
    onError: (err) => refreshAfterSlotTaken(queryClient, err),
  });
}

/** `PUT /me/kyc/interview` — đổi sang slot khác (BE chặn khi quá mốc cutoff: `CANCEL_TOO_LATE`). */
export function useRescheduleInterview(): UseMutationResult<MyInterviewResponse, Error, string> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<MyInterviewResponse, Error, string>({
    mutationFn: (slotId) =>
      client.put('/me/kyc/interview', { body: { slotId }, schema: myInterviewResponseSchema }),
    onSuccess: (data) => applyBookingResult(queryClient, data),
    onError: async (err) => {
      await refreshAfterSlotTaken(queryClient, err);
      await queryClient.invalidateQueries({ queryKey: MY_INTERVIEW_QUERY_KEY, exact: true });
    },
  });
}

/** `DELETE /me/kyc/interview` — huỷ lịch (BE chặn khi quá mốc cutoff: `CANCEL_TOO_LATE`). */
export function useCancelInterview(): UseMutationResult<MyInterviewResponse, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<MyInterviewResponse, Error, void>({
    mutationFn: () => client.delete('/me/kyc/interview', { schema: myInterviewResponseSchema }),
    onSuccess: (data) => applyBookingResult(queryClient, data),
    onError: () => queryClient.invalidateQueries({ queryKey: MY_INTERVIEW_QUERY_KEY, exact: true }),
  });
}
