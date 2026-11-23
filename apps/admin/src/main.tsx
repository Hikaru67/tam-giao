import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { createApiClient, isApiError } from '@tamgiao/api-client';
import { AdminApp } from './app';
import { ADMIN_ENV } from './env';
import { createAdminTokenStore, browserSessionStorage } from './features/auth/session-token-store';
import { createSessionEvents } from './features/auth/session-events';
import './index.css';

const tokenStore = createAdminTokenStore(browserSessionStorage());
const sessionEvents = createSessionEvents();
const apiClient = createApiClient({
  baseUrl: ADMIN_ENV.apiUrl,
  tokenStore,
  onSignedOut: () => sessionEvents.emitSignedOut(),
});
const queryClient = new QueryClient({
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
      <AdminApp
        apiClient={apiClient}
        queryClient={queryClient}
        tokenStore={tokenStore}
        sessionEvents={sessionEvents}
      />
    </StrictMode>,
  );
}
