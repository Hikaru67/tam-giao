import { render } from '@testing-library/react';
import { createMemoryHistory } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { createApiClient } from '@tamgiao/api-client';
import { TEST_API_URL } from '@tamgiao/api-client/mocks';
import { PartnerApp } from '../app';
import { createPartnerTokenStore } from '../features/auth/session-token-store';
import { createSessionEvents } from '../features/auth/session-events';

export async function renderApp(path: string, options?: { token?: string }) {
  const tokenStore = createPartnerTokenStore(null);
  if (options?.token) {
    await tokenStore.setPartnerToken(options.token);
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
      mutations: { retry: false, gcTime: 0 },
    },
  });
  const history = createMemoryHistory({ initialEntries: [path] });
  const renderResult = render(
    <PartnerApp
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
