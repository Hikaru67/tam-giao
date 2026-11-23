import type { ApiClient } from '@tamgiao/api-client';
import { queryOptions } from '@tanstack/react-query';
import { PAGE_LIMIT_MAX } from '@tamgiao/contracts/http';
import {
  adminInterviewSlotListResponseSchema,
  adminInterviewSlotSchema,
  openInterviewSlotBodySchema,
  recordInterviewResultBodySchema,
  type AdminInterviewSlot,
  type AdminInterviewSlotListResponse,
  type OpenInterviewSlotBody,
  type RecordInterviewResultBody,
} from '@tamgiao/contracts/verification';
import { addDays } from './week';

export const INTERVIEW_SLOTS_QUERY_KEY = ['admin', 'interview', 'slots'] as const;

export function fetchInterviewSlots(
  client: ApiClient,
  range: { from: string; to: string },
  signal?: AbortSignal,
): Promise<AdminInterviewSlotListResponse> {
  return client.get('/admin/kyc/interview/slots', {
    query: {
      from: range.from,
      to: range.to,
      limit: PAGE_LIMIT_MAX,
    },
    schema: adminInterviewSlotListResponseSchema,
    signal,
  });
}

export function interviewSlotsQueryOptions(client: ApiClient, weekStart: Date) {
  const from = weekStart.toISOString();
  const to = addDays(weekStart, 7).toISOString();
  return queryOptions({
    queryKey: [...INTERVIEW_SLOTS_QUERY_KEY, weekStart.toISOString()] as const,
    queryFn: ({ signal }) => fetchInterviewSlots(client, { from, to }, signal),
  });
}

export function openInterviewSlot(
  client: ApiClient,
  body: OpenInterviewSlotBody,
): Promise<AdminInterviewSlot> {
  return client.post('/admin/kyc/interview/slots', {
    body: openInterviewSlotBodySchema.parse(body),
    schema: adminInterviewSlotSchema,
  });
}

export function recordInterviewNotes(
  client: ApiClient,
  slotId: string,
  body: RecordInterviewResultBody,
): Promise<AdminInterviewSlot> {
  return client.put(`/admin/kyc/interview/${encodeURIComponent(slotId)}/notes`, {
    body: recordInterviewResultBodySchema.parse(body),
    schema: adminInterviewSlotSchema,
  });
}
