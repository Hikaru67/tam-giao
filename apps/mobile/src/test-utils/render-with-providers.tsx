import type { ReactElement, ReactNode } from 'react';
import { ApiClientProvider } from '@tamgiao/api-client/react';
import {
  createApiClient,
  createMemoryTokenStore,
  type ApiClient,
  type TokenStore,
} from '@tamgiao/api-client';
import { ToastProvider } from '@tamgiao/ui-mobile';
import { TokenStoreProvider } from '../session/token-store-context.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';

export function createFakeFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown },
): typeof fetch {
  return jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    const result = handler(urlStr, init);
    const status = result.status ?? 200;
    const bodyStr = result.body !== undefined ? JSON.stringify(result.body) : '';

    return new Response(bodyStr, {
      status,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as unknown as typeof fetch;
}

export function createProblemBody(options: {
  code: string;
  status?: number;
  title?: string;
  meta?: Record<string, unknown>;
  errors?: { path: string; message: string }[];
}) {
  return {
    type: 'about:blank',
    title: options.title ?? 'Lỗi xảy ra',
    status: options.status ?? 400,
    code: options.code,
    traceId: 'trace-test-123',
    meta: options.meta,
    errors: options.errors,
  };
}

export interface RenderOptions {
  client?: ApiClient;
  queryClient?: QueryClient;
  tokenStore?: TokenStore;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

export async function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const tokenStore = options.tokenStore ?? createMemoryTokenStore();
  const client =
    options.client ??
    createApiClient({
      baseUrl: 'http://api.test',
      tokenStore,
      fetch: createFakeFetch(() => ({ status: 200, body: {} })),
    });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={client}>
          <TokenStoreProvider store={tokenStore}>
            <ToastProvider>{children}</ToastProvider>
          </TokenStoreProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    );
  }

  const result = await render(ui, { wrapper: Wrapper });
  return {
    ...result,
    queryClient,
    client,
    tokenStore,
  };
}
