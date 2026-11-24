import { isApiError } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  myCheckInResponseSchema,
  safetyCheckInSchema,
  type CheckInBody,
  type MyCheckInResponse,
  type SafetyCheckInDto,
} from '@tamgiao/contracts/dating';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { CURRENT_DATE_QUERY_KEY } from '../use-dates.js';
import { getOneShotLocation, type CheckInLocation } from './location.js';

export const CHECK_IN_POLL_INTERVAL_MS = 15_000;

export function checkInQueryKey(datePlanId: string) {
  return ['dates', 'check-in', datePlanId] as const;
}

export function useMyCheckIn(
  datePlanId: string,
  enabled: boolean,
  /** Hỏi lại định kỳ khi chưa check-in (quán có thể quét voucher). */
  pollUntilCheckedIn: boolean,
): UseQueryResult<MyCheckInResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: checkInQueryKey(datePlanId),
    queryFn: () =>
      client.get(`/me/dates/${datePlanId}/check-in`, {
        schema: myCheckInResponseSchema,
      }),
    enabled,
    refetchInterval: (query) =>
      pollUntilCheckedIn && (query.state.data?.checkIn ?? null) === null ? CHECK_IN_POLL_INTERVAL_MS : false,
  });
}

export interface CheckInVariables {
  readonly shareLocation: boolean;
}

export interface CheckInMutationResult {
  readonly checkIn: SafetyCheckInDto;
  readonly locationRequestedButMissing: boolean;
}

export function useCheckIn(
  datePlanId: string,
): UseMutationResult<CheckInMutationResult, Error, CheckInVariables> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<CheckInMutationResult, Error, CheckInVariables>({
    gcTime: 0,
    mutationFn: async ({ shareLocation }) => {
      let location: CheckInLocation | null = null;
      let locationRequestedButMissing = false;

      if (shareLocation) {
        location = await getOneShotLocation();
        if (location === null) {
          locationRequestedButMissing = true;
        }
      }

      const body: CheckInBody =
        location !== null
          ? {
              location: {
                latitude: location.latitude,
                longitude: location.longitude,
                ...(location.accuracyMeters !== undefined ? { accuracyMeters: location.accuracyMeters } : {}),
              },
            }
          : {};

      const checkIn = await client.post(`/me/dates/${datePlanId}/check-in`, {
        body,
        schema: safetyCheckInSchema,
      });

      return { checkIn, locationRequestedButMissing };
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(checkInQueryKey(datePlanId), { checkIn: data.checkIn });
      await queryClient.invalidateQueries({ queryKey: CURRENT_DATE_QUERY_KEY });
    },
    onError: async (error) => {
      if (
        isApiError(error) &&
        (error.code === 'DATE_ALREADY_CHECKED_IN' || error.code === 'DATE_NOT_CHECKED_IN')
      ) {
        await queryClient.invalidateQueries({ queryKey: checkInQueryKey(datePlanId) });
      }
    },
  });
}

export function useCheckOut(datePlanId: string): UseMutationResult<SafetyCheckInDto, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<SafetyCheckInDto, Error, void>({
    gcTime: 0,
    mutationFn: () =>
      client.post(`/me/dates/${datePlanId}/check-out`, {
        schema: safetyCheckInSchema,
      }),
    onSuccess: async (data) => {
      queryClient.setQueryData(checkInQueryKey(datePlanId), { checkIn: data });
      await queryClient.invalidateQueries({ queryKey: CURRENT_DATE_QUERY_KEY });
    },
    onError: async (error) => {
      if (
        isApiError(error) &&
        (error.code === 'DATE_ALREADY_CHECKED_IN' || error.code === 'DATE_NOT_CHECKED_IN')
      ) {
        await queryClient.invalidateQueries({ queryKey: checkInQueryKey(datePlanId) });
      }
    },
  });
}
