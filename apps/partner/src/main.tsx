import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createApiClient, isApiError } from '@tamgiao/api-client';
import { reportError } from './observability';
import { PartnerApp } from './app';
import { PARTNER_ENV } from './env';
import { createPartnerTokenStore, browserSessionStorage } from './features/auth/session-token-store';
import { createSessionEvents } from './features/auth/session-events';
import './index.css';

const tokenStore = createPartnerTokenStore(browserSessionStorage());
const sessionEvents = createSessionEvents();
const apiClient = createApiClient({
  baseUrl: PARTNER_ENV.apiUrl,
  tokenStore,
  onSignedOut: () => sessionEvents.emitSignedOut(),
});
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportError }),
  mutationCache: new MutationCache({ onError: reportError }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        !(isApiError(error) && error.status >= 400 && error.status < 500) && failureCount < 2,
    },
  },
});

const rootElement = document.getElementById('root');
if (rootElement && !rootElement.innerHTML) {
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <PartnerApp
        apiClient={apiClient}
        queryClient={queryClient}
        tokenStore={tokenStore}
        sessionEvents={sessionEvents}
      />
    </StrictMode>,
  );
}
