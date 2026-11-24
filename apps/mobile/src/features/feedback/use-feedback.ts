import { isApiError } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  myFeedbackResponseSchema,
  myFeedbackSchema,
  type MyFeedbackDto,
  type MyFeedbackResponse,
  type SubmitFeedbackBody,
} from '@tamgiao/contracts/dating';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { CURRENT_DATE_QUERY_KEY } from '../dates/use-dates.js';
import { CONVERSATIONS_QUERY_KEY, CURRENT_MATCH_QUERY_KEY } from '../match/use-match.js';

export const FEEDBACK_QUERY_KEY = (datePlanId: string) => ['dates', 'feedback', datePlanId] as const;

export function useMyFeedback(datePlanId: string, enabled = true): UseQueryResult<MyFeedbackResponse, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: FEEDBACK_QUERY_KEY(datePlanId),
    queryFn: () => client.get(`/me/dates/${datePlanId}/feedback`, { schema: myFeedbackResponseSchema }),
    enabled,
  });
}

export function useSubmitFeedback(
  datePlanId: string,
): UseMutationResult<MyFeedbackDto, Error, SubmitFeedbackBody> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<MyFeedbackDto, Error, SubmitFeedbackBody>({
    mutationFn: (body) => client.post(`/me/dates/${datePlanId}/feedback`, { body, schema: myFeedbackSchema }),
    onSuccess: async (data) => {
      queryClient.setQueryData(FEEDBACK_QUERY_KEY(datePlanId), { feedback: data });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CURRENT_MATCH_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: CURRENT_DATE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY }),
      ]);
    },
    onError: async (error) => {
      if (isApiError(error) && error.code === 'FEEDBACK_ALREADY_SUBMITTED') {
        await queryClient.invalidateQueries({ queryKey: FEEDBACK_QUERY_KEY(datePlanId) });
      }
    },
  });
}
