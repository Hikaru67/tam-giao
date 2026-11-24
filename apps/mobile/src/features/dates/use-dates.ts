import { useApiClient } from '@tamgiao/api-client/react';
import {
  currentDatePlanResponseSchema,
  datePlanSchema,
  type CurrentDatePlanResponse,
  type DatePlanDto,
  type ProposeDateBody,
} from '@tamgiao/contracts/dating';
import type { NotificationKindName } from '@tamgiao/contracts/notification';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { VOUCHERS_QUERY_KEY } from '../kyc/use-verification-status.js';
import { useForegroundNotification } from '../notifications/use-foreground-notification.js';

export const CURRENT_DATE_QUERY_KEY = ['dates', 'current'] as const;

export function useCurrentDate(): UseQueryResult<CurrentDatePlanResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: CURRENT_DATE_QUERY_KEY,
    queryFn: () => client.get('/me/dates/current', { schema: currentDatePlanResponseSchema }),
  });
}

export function useProposeDate(): UseMutationResult<DatePlanDto, Error, ProposeDateBody> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<DatePlanDto, Error, ProposeDateBody>({
    mutationFn: (body) => client.post('/me/dates', { body, schema: datePlanSchema }),
    onSuccess: (data) => {
      queryClient.setQueryData(CURRENT_DATE_QUERY_KEY, { datePlan: data });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: CURRENT_DATE_QUERY_KEY }),
  });
}

export function useRespondDate(): UseMutationResult<
  DatePlanDto,
  Error,
  { id: string; action: 'confirm' | 'decline' }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<DatePlanDto, Error, { id: string; action: 'confirm' | 'decline' }>({
    mutationFn: ({ id, action }) => client.post(`/me/dates/${id}/${action}`, { schema: datePlanSchema }),
    onSuccess: async (data, variables) => {
      queryClient.setQueryData(CURRENT_DATE_QUERY_KEY, { datePlan: data });
      if (variables.action === 'confirm') {
        await queryClient.invalidateQueries({ queryKey: VOUCHERS_QUERY_KEY });
      }
    },
    onError: () => queryClient.invalidateQueries({ queryKey: CURRENT_DATE_QUERY_KEY }),
  });
}

export function useCancelDate(): UseMutationResult<DatePlanDto, Error, string> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<DatePlanDto, Error, string>({
    mutationFn: (id) => client.post(`/me/dates/${id}/cancel`, { schema: datePlanSchema }),
    onSuccess: async (data) => {
      queryClient.setQueryData(CURRENT_DATE_QUERY_KEY, { datePlan: data });
      await queryClient.invalidateQueries({ queryKey: VOUCHERS_QUERY_KEY });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: CURRENT_DATE_QUERY_KEY }),
  });
}

export const DATE_PUSH_KINDS = [
  'DATE_PROPOSED',
  'DATE_CONFIRMED',
  'DATE_REMINDER',
] as const satisfies readonly NotificationKindName[];

export function useDatePushRefresh(): void {
  const queryClient = useQueryClient();
  useForegroundNotification(DATE_PUSH_KINDS, () => {
    void queryClient.invalidateQueries({ queryKey: CURRENT_DATE_QUERY_KEY });
  });
}
