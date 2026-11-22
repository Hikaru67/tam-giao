import { Button, Text, View } from 'react-native';
import { createApiClient } from '@tamgiao/api-client';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { createFakeFetch, renderWithProviders } from '../../test-utils/render-with-providers.js';
import { useRevokeSession, useSessions } from './use-sessions.js';

function SessionsTester() {
  const { data, isLoading } = useSessions();
  const revoke = useRevokeSession();

  if (isLoading) {
    return <Text>Đang tải danh sách...</Text>;
  }

  return (
    <View>
      <Text testID="session-count">{data?.items.length ?? 0}</Text>
      {data?.items.map((item) => (
        <View key={item.id}>
          <Text testID={`session-${item.id}`}>{item.deviceName ?? 'Không tên'}</Text>
          <Button
            title={`Thu hồi ${item.id}`}
            testID={`revoke-${item.id}`}
            onPress={() => revoke.mutate(item.id)}
          />
        </View>
      ))}
    </View>
  );
}

describe('useSessions & useRevokeSession (FE-S2-02)', () => {
  it('useSessions đọc danh sách thiết bị và useRevokeSession gọi DELETE', async () => {
    let deletedSessionId: string | null = null;
    let listCallCount = 0;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/auth/sessions' && (!init?.method || init.method === 'GET')) {
        listCallCount++;
        return {
          status: 200,
          body: {
            items: [
              {
                id: '01952e46-953b-789a-b283-a9d701897d26',
                deviceName: 'iPhone 15 Pro',
                createdAt: '2026-11-20T10:00:00.000Z',
                lastUsedAt: '2026-11-22T08:00:00.000Z',
                current: true,
              },
              {
                id: '01952e46-953b-789a-b283-a9d701897d27',
                deviceName: 'iPad Air',
                createdAt: '2026-11-19T10:00:00.000Z',
                lastUsedAt: '2026-11-21T08:00:00.000Z',
                current: false,
              },
            ],
          },
        };
      }
      if (url.startsWith('http://api.test/auth/sessions/') && init?.method === 'DELETE') {
        deletedSessionId = url.replace('http://api.test/auth/sessions/', '');
        return { status: 204 };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: {
        getAccessToken: jest.fn(async () => 'mock-jwt'),
        getRefreshToken: jest.fn(async () => 'mock-refresh'),
        setTokens: jest.fn(),
        clear: jest.fn(),
      },
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<SessionsTester />, { client });

    await waitFor(() => {
      expect(screen.getByTestId('session-count').props.children).toBe(2);
      expect(screen.getByTestId('session-01952e46-953b-789a-b283-a9d701897d26')).toBeTruthy();
      expect(screen.getByTestId('session-01952e46-953b-789a-b283-a9d701897d27')).toBeTruthy();
    });

    const revokeBtn = screen.getByTestId('revoke-01952e46-953b-789a-b283-a9d701897d27');
    await act(async () => {
      await fireEvent.press(revokeBtn);
    });

    await waitFor(() => {
      expect(deletedSessionId).toBe('01952e46-953b-789a-b283-a9d701897d27');
      expect(listCallCount).toBeGreaterThanOrEqual(2);
    });
  });
});
