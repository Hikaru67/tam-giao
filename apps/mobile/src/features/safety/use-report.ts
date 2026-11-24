import { useApiClient } from '@tamgiao/api-client/react';
import {
  fileReportBodySchema,
  fileReportResponseSchema,
  type FileReportBody,
  type FileReportResponse,
} from '@tamgiao/contracts/safety';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { CONVERSATIONS_QUERY_KEY, CURRENT_MATCH_QUERY_KEY } from '../match/use-match.js';
import { markPeerReported } from './reported-peers.js';

export interface SubmitReportInput {
  reportedUserId: string;
  category: FileReportBody['category'];
  description?: string | undefined;
  evidenceKeys?: readonly string[] | undefined;
  urgentIntervention?: boolean | undefined;
}

export function useFileReport(): UseMutationResult<FileReportResponse, Error, SubmitReportInput> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SubmitReportInput) => {
      const trimmedDescription = input.description?.trim();
      const rawBody = {
        reportedUserId: input.reportedUserId,
        category: input.category,
        ...(trimmedDescription && trimmedDescription.length > 0 ? { description: trimmedDescription } : {}),
        ...(input.evidenceKeys && input.evidenceKeys.length > 0
          ? { evidenceKeys: [...input.evidenceKeys] }
          : {}),
        ...(input.urgentIntervention ? { urgentIntervention: true } : {}),
      };

      const body = fileReportBodySchema.parse(rawBody);

      return client.post('/me/reports', {
        body,
        schema: fileReportResponseSchema,
      });
    },
    onSuccess: (_data, variables) => {
      markPeerReported(queryClient, variables.reportedUserId);
      void queryClient.invalidateQueries({ queryKey: CURRENT_MATCH_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
    },
  });
}
