import { useState } from 'react';
import { useApiClient } from '@tamgiao/api-client/react';
import { dataExportViewSchema, type DataExportView } from '@tamgiao/contracts/identity';
import { useMutation, useQuery } from '@tanstack/react-query';

/**
 * Hook quản lý luồng xuất dữ liệu cá nhân theo Nghị định 13 (FE-S2-06).
 * Quy ước: không lưu exportId vào storage thường (chỉ giữ trong React state / memory).
 * TanStack Query poll GET /me/data-exports/:id mỗi 3s khi status === 'PENDING', dừng khi READY / EXPIRED.
 */
export function useDataExportFlow() {
  const client = useApiClient();
  const [currentExportId, setCurrentExportId] = useState<string | null>(null);

  const requestMutation = useMutation({
    mutationFn: async () => {
      const res = await client.post('/me/data-exports', {
        schema: dataExportViewSchema,
      });
      setCurrentExportId(res.exportId);
      return res;
    },
  });

  const query = useQuery({
    queryKey: ['data-export', currentExportId],
    queryFn: () =>
      client.get(`/me/data-exports/${currentExportId}`, {
        schema: dataExportViewSchema,
      }),
    enabled: Boolean(currentExportId),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'PENDING' ? 3000 : false;
    },
  });

  const currentExport: DataExportView | null = query.data ?? requestMutation.data ?? null;

  return {
    currentExport,
    currentExportId,
    isRequesting: requestMutation.isPending,
    requestError: requestMutation.error,
    requestExport: requestMutation.mutateAsync,
    resetExport: () => {
      setCurrentExportId(null);
      requestMutation.reset();
    },
  };
}
