import { NOTIFICATION_KIND_NAMES, type NotificationKindName } from '@tamgiao/contracts/notification';
import { act } from '@testing-library/react-native';
import { routeForNotification, useNotificationResponseRouter } from './router.js';
import { renderWithProviders } from '../../test-utils/render-with-providers.js';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

let mockNotificationResponseListener: ((response: unknown) => void) | null = null;
const mockRemoveListener = jest.fn();
const mockGetLastNotificationResponseAsync = jest.fn(async () => null);

jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: () => mockGetLastNotificationResponseAsync(),
  addNotificationResponseReceivedListener: (cb: (response: unknown) => void) => {
    mockNotificationResponseListener = cb;
    return { remove: mockRemoveListener };
  },
}));

function RouterTester() {
  useNotificationResponseRouter();
  return null;
}

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('routeForNotification & useNotificationResponseRouter (FE-S2-05)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotificationResponseListener = null;
  });

  it('routeForNotification lặp qua mọi NOTIFICATION_KIND_NAMES có route', () => {
    const samples: Record<NotificationKindName, Record<string, unknown>> = {
      MATCH_OFFERED: { matchId: VALID_UUID },
      MATCH_OFFER_EXPIRING: { matchId: VALID_UUID },
      MATCH_AWAITING_RESPONSE: { matchId: VALID_UUID },
      MATCH_STARTED_DATING: { matchId: VALID_UUID },
      MESSAGE_RECEIVED: { conversationId: VALID_UUID },
      DATE_PROPOSED: { datePlanId: VALID_UUID },
      DATE_CONFIRMED: { datePlanId: VALID_UUID },
      DATE_REMINDER: { datePlanId: VALID_UUID },
      KYC_APPROVED: { submissionId: VALID_UUID },
      KYC_REJECTED: { submissionId: VALID_UUID },
      REFUND_COMPLETED: { paymentId: VALID_UUID },
      REPORT_RECEIVED: { reportId: VALID_UUID },
      REPORT_UPDATED: { reportId: VALID_UUID },
      DATING_REMINDER_FIRST: { matchId: VALID_UUID },
      DATING_REMINDER_FINAL: { matchId: VALID_UUID },
    };

    expect(NOTIFICATION_KIND_NAMES.length).toBe(15);

    for (const kind of NOTIFICATION_KIND_NAMES) {
      const data = { kind, ...samples[kind] };
      const route = routeForNotification(data);
      expect(route).toBeDefined();
      expect(typeof route).toBe('string');
      expect(route?.startsWith('/')).toBe(true);

      if (kind.startsWith('MATCH_')) {
        expect(route).toBe('/(main)/home');
      } else if (kind === 'MESSAGE_RECEIVED') {
        expect(route).toBe(`/(main)/chat/${VALID_UUID}`);
      } else if (kind.startsWith('DATE_')) {
        expect(route).toBe(`/(main)/dates/${VALID_UUID}`);
      } else if (kind.startsWith('KYC_') || kind === 'REFUND_COMPLETED') {
        expect(route).toBe('/');
      } else if (kind.startsWith('REPORT_')) {
        expect(route).toBe('/(main)/safety');
      } else if (kind.startsWith('DATING_REMINDER_')) {
        expect(route).toBe('/(main)/dates');
      }
    }
  });

  it('id sai → "/"', () => {
    expect(routeForNotification({ kind: 'MESSAGE_RECEIVED', conversationId: 'invalid-id' })).toBe('/');
    expect(routeForNotification({ kind: 'MESSAGE_RECEIVED' })).toBe('/');
    expect(routeForNotification({ kind: 'DATE_PROPOSED', datePlanId: 'invalid-id' })).toBe('/');
    expect(routeForNotification({ kind: 'DATE_CONFIRMED', datePlanId: 'not-a-uuid' })).toBe('/');
    expect(routeForNotification({ kind: 'DATE_REMINDER', datePlanId: '12345' })).toBe('/');
    expect(routeForNotification({ kind: 'MATCH_OFFERED', matchId: 'invalid-id' })).toBe('/');
    expect(routeForNotification({ kind: 'REPORT_RECEIVED', reportId: 'invalid-id' })).toBe('/');
    expect(routeForNotification({ kind: 'KYC_APPROVED', submissionId: 'invalid-id' })).toBe('/');
    expect(routeForNotification({ kind: 'DATING_REMINDER_FIRST', datePlanId: 'invalid-id' })).toBe('/');
  });

  it('DATE_* khi thiếu datePlanId → "/(main)/dates"', () => {
    expect(routeForNotification({ kind: 'DATE_PROPOSED' })).toBe('/(main)/dates');
    expect(routeForNotification({ kind: 'DATE_CONFIRMED' })).toBe('/(main)/dates');
    expect(routeForNotification({ kind: 'DATE_REMINDER' })).toBe('/(main)/dates');
    expect(routeForNotification({ kind: 'DATING_REMINDER_FIRST' })).toBe('/(main)/dates');
    expect(routeForNotification({ kind: 'DATING_REMINDER_FINAL' })).toBe('/(main)/dates');
  });

  it('dữ liệu không hợp lệ hoặc loại không tồn tại → null', () => {
    expect(routeForNotification(null)).toBeNull();
    expect(routeForNotification(undefined)).toBeNull();
    expect(routeForNotification('')).toBeNull();
    expect(routeForNotification(123)).toBeNull();
    expect(routeForNotification([])).toBeNull();
    expect(routeForNotification({})).toBeNull();
    expect(routeForNotification({ kind: 'UNKNOWN_KIND' })).toBeNull();
  });

  it('useNotificationResponseRouter điều hướng khi nhận sự kiện bấm thông báo', async () => {
    const screen = await renderWithProviders(<RouterTester />);

    expect(mockNotificationResponseListener).toBeDefined();

    await act(async () => {
      mockNotificationResponseListener?.({
        notification: {
          request: {
            content: {
              data: {
                kind: 'MESSAGE_RECEIVED',
                conversationId: VALID_UUID,
              },
            },
          },
        },
      });
    });

    expect(mockPush).toHaveBeenCalledWith(`/(main)/chat/${VALID_UUID}`);
    await screen.unmount();
  });

  it('useNotificationResponseRouter điều hướng thông báo khi cold start', async () => {
    mockGetLastNotificationResponseAsync.mockResolvedValueOnce({
      notification: {
        request: {
          content: {
            data: {
              kind: 'MATCH_OFFERED',
              matchId: VALID_UUID,
            },
          },
        },
      },
    } as never);

    const screen = await renderWithProviders(<RouterTester />);

    await act(async () => {});

    expect(mockPush).toHaveBeenCalledWith('/(main)/home');
    await screen.unmount();
  });
});
