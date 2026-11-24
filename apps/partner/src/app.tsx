import { useState, useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import type { RouterHistory } from '@tanstack/react-router';
import { RouterProvider } from '@tanstack/react-router';
import type { ApiClient } from '@tamgiao/api-client';
import { ApiClientProvider } from '@tamgiao/api-client/react';
import type { PartnerTokenStore } from './features/auth/session-token-store';
import type { SessionEvents } from './features/auth/session-events';
import { ToastProvider } from '@tamgiao/ui-web';
import { PartnerSessionProvider } from './features/auth/partner-session-context';
import { createPartnerRouter } from './router';

export function PartnerApp(props: {
  apiClient: ApiClient;
  queryClient: QueryClient;
  tokenStore: PartnerTokenStore;
  sessionEvents: SessionEvents;
  history?: RouterHistory;
}) {
  const [router] = useState(() =>
    createPartnerRouter({
      context: {
        apiClient: props.apiClient,
        queryClient: props.queryClient,
        tokenStore: props.tokenStore,
      },
      ...(props.history ? { history: props.history } : {}),
    }),
  );

  useEffect(() => {
    return props.sessionEvents.onSignedOut(() => {
      props.queryClient.clear();
      const { pathname, href } = router.state.location;
      if (pathname !== '/login') {
        void router.navigate({ to: '/login', search: { redirect: href } });
      }
    });
  }, [props.sessionEvents, props.queryClient, router]);

  return (
    <QueryClientProvider client={props.queryClient}>
      <ApiClientProvider client={props.apiClient}>
        <PartnerSessionProvider tokenStore={props.tokenStore}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </PartnerSessionProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
