import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@tamgiao/api-client/react';
import type { OpenInterviewSlotBody, RecordInterviewResultBody } from '@tamgiao/contracts/verification';
import {
  INTERVIEW_SLOTS_QUERY_KEY,
  interviewSlotsQueryOptions,
  openInterviewSlot,
  recordInterviewNotes,
} from './interview-api';

export function useInterviewSlots(weekStart: Date) {
  const client = useApiClient();
  return useQuery(interviewSlotsQueryOptions(client, weekStart));
}

export function useOpenInterviewSlot() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: OpenInterviewSlotBody) => openInterviewSlot(client, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: INTERVIEW_SLOTS_QUERY_KEY });
    },
  });
}

export function useRecordInterviewNotes() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ slotId, body }: { slotId: string; body: RecordInterviewResultBody }) =>
      recordInterviewNotes(client, slotId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: INTERVIEW_SLOTS_QUERY_KEY });
    },
  });
}
