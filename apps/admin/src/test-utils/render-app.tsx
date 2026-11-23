import { render } from '@testing-library/react';
import { createMemoryHistory } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { createApiClient } from '@tamgiao/api-client';
import { TEST_API_URL } from '@tamgiao/api-client/mocks';
import { AdminApp } from '../app';
import { createAdminTokenStore } from '../features/auth/session-token-store';
import { createSessionEvents } from '../features/auth/session-events';

export async function renderApp(path: string, options?: { token?: string }) {
  const tokenStore = createAdminTokenStore(null);
  if (options?.token) {
    await tokenStore.setAdminToken(options.token);
  }
  const sessionEvents = createSessionEvents();
  const apiClient = createApiClient({
    baseUrl: TEST_API_URL,
    tokenStore,
    onSignedOut: () => sessionEvents.emitSignedOut(),
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const history = createMemoryHistory({ initialEntries: [path] });
  const renderResult = render(
    <AdminApp
      apiClient={apiClient}
      queryClient={queryClient}
      tokenStore={tokenStore}
      sessionEvents={sessionEvents}
      history={history}
    />,
  );
  return {
    history,
    tokenStore,
    queryClient,
    sessionEvents,
    apiClient,
    ...renderResult,
  };
}
