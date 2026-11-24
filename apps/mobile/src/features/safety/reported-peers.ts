import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

export const REPORTED_PEERS_QUERY_KEY = ['safety', 'reported-peers'] as const;

export function markPeerReported(queryClient: QueryClient, userId: string): void {
  queryClient.setQueryData<readonly string[]>(REPORTED_PEERS_QUERY_KEY, (prev = []) => {
    if (prev.includes(userId)) {
      return prev;
    }
    return [...prev, userId];
  });
}

export function useIsPeerReported(userId: string | null): boolean {
  const queryClient = useQueryClient();
  const query = useQuery<readonly string[]>({
    queryKey: REPORTED_PEERS_QUERY_KEY,
    queryFn: () => queryClient.getQueryData<readonly string[]>(REPORTED_PEERS_QUERY_KEY) ?? [],
    enabled: false,
    initialData: [],
    staleTime: Infinity,
    // Giữ suốt phiên (không hẹn giờ dọn); đăng xuất xoá toàn bộ cache.
    gcTime: Infinity,
  });

  if (userId === null) {
    return false;
  }
  return query.data.includes(userId);
}
