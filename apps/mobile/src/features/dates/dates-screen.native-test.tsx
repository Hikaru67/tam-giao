import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import { DATE_CANCEL_CUTOFF_HOURS } from '@tamgiao/contracts/constants';
import type { PartnerDto, PartnerListResponse } from '@tamgiao/contracts/billing';
import type { CurrentDatePlanResponse, DatePlanDto } from '@tamgiao/contracts/dating';
import type { CurrentMatchDto, CurrentMatchResponse } from '@tamgiao/contracts/matching';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { createFixedClock } from './clock.js';
import { DATES_COPY } from './copy.js';
import { DatesScreen } from './dates-screen.js';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => ({}),
}));

let notificationListener: ((notification: { request: { content: { data: unknown } } }) => void) | null = null;
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: (
    fn: (notification: { request: { content: { data: unknown } } }) => void,
  ) => {
    notificationListener = fn;
    return {
      remove: () => {
        notificationListener = null;
      },
    };
  },
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));

const NOW = '2026-11-24T03:00:00.000Z';
const PARTNER_ID_1 = '01890a5d-ac96-774b-bcce-b302099a8011';
const PARTNER_ID_2 = '01890a5d-ac96-774b-bcce-b302099a8012';
const PLAN_ID = '01890a5d-ac96-774b-bcce-b302099a8021';
const MATCH_ID = '01890a5d-ac96-774b-bcce-b302099a8031';
const USER_A_ID = '01890a5d-ac96-774b-bcce-b302099a8041';
const USER_B_ID = '01890a5d-ac96-774b-bcce-b302099a8042';

const SAMPLE_PARTNER_1: PartnerDto = {
  id: PARTNER_ID_1,
  name: 'The Running Bean',
  address: '33 Mạc Thị Bưởi, Q.1',
  photoUrl: null,
  tags: ['Bàn riêng yên tĩnh'],
};

const SAMPLE_PARTNER_2: PartnerDto = {
  id: PARTNER_ID_2,
  name: 'RuNam Bistro',
  address: '96 Mạc Thị Bưởi, Q.1',
  photoUrl: null,
  tags: ['Bàn riêng yên tĩnh'],
};

const SAMPLE_MATCH: CurrentMatchDto = {
  matchId: MATCH_ID,
  status: 'DATING',
  phase: 'DATING',
  expiresAt: '2026-12-05T03:00:00.000Z',
  offeredAt: '2026-11-20T03:00:00.000Z',
  datingStartedAt: '2026-11-21T03:00:00.000Z',
  score: null,
  commonPoints: ['SAME_CITY'],
  staffNote: null,
  counterpart: {
    userId: USER_B_ID,
    displayName: 'Minh Trang',
    age: 28,
    currentCity: 'TP. Hồ Chí Minh',
    occupation: 'Kiểm toán',
    education: 'bachelor',
    avatar: null,
  },
};

const SAMPLE_PLAN: DatePlanDto = {
  id: PLAN_ID,
  matchId: MATCH_ID,
  inviterId: USER_A_ID,
  inviteeId: USER_B_ID,
  myRole: 'INVITER',
  partnerId: PARTNER_ID_1,
  startsAt: '2026-11-25T09:00:00.000Z',
  endsAt: '2026-11-25T11:00:00.000Z',
  staffBookingRequested: true,
  status: 'PROPOSED',
  expiresAt: '2026-11-25T03:00:00.000Z',
  proposedAt: '2026-11-24T03:00:00.000Z',
  respondedAt: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelDeadline: '2026-11-25T05:00:00.000Z',
};

function setupClient(handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown }) {
  const fakeFetch = createFakeFetch(handler);
  const client = createApiClient({
    baseUrl: 'http://api.test',
    tokenStore: createMemoryTokenStore(),
    fetch: fakeFetch,
  });
  const queryClient = createTestQueryClient();
  return { client, queryClient };
}

describe('DatesScreen (FE-S5-01)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    notificationListener = null;
  });

  it('renders EmptyState when match is null and no date plan', async () => {
    const { client, queryClient } = setupClient((url) => {
      if (url === 'http://api.test/me/match') {
        const body: CurrentMatchResponse = { match: null };
        return { status: 200, body };
      }
      if (url === 'http://api.test/me/dates/current') {
        const body: CurrentDatePlanResponse = { datePlan: null };
        return { status: 200, body };
      }
      if (url === 'http://api.test/partners') {
        const body: PartnerListResponse = { items: [SAMPLE_PARTNER_1] };
        return { status: 200, body };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(NOW)} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByText(DATES_COPY.notDating.title)).toBeTruthy();
      expect(screen.getByText(DATES_COPY.notDating.description)).toBeTruthy();
    });

    await screen.unmount();
  });

  describe('AC1: Buttons visibility for roles in PROPOSED status', () => {
    it('Inviter does NOT see date-confirm, date-decline, or date-cancel buttons', async () => {
      const { client, queryClient } = setupClient((url) => {
        if (url === 'http://api.test/me/match') {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        if (url === 'http://api.test/me/dates/current') {
          return { status: 200, body: { datePlan: { ...SAMPLE_PLAN, myRole: 'INVITER' } } };
        }
        if (url === 'http://api.test/partners') {
          return { status: 200, body: { items: [SAMPLE_PARTNER_1] } };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(NOW)} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByText(SAMPLE_PARTNER_1.name)).toBeTruthy();
      });

      expect(screen.queryByTestId('date-confirm')).toBeNull();
      expect(screen.queryByTestId('date-decline')).toBeNull();
      expect(screen.queryByTestId('date-cancel')).toBeNull();

      await screen.unmount();
    });

    it('Invitee sees date-confirm and date-decline buttons, but NOT date-cancel button', async () => {
      const { client, queryClient } = setupClient((url) => {
        if (url === 'http://api.test/me/match') {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        if (url === 'http://api.test/me/dates/current') {
          return { status: 200, body: { datePlan: { ...SAMPLE_PLAN, myRole: 'INVITEE' } } };
        }
        if (url === 'http://api.test/partners') {
          return { status: 200, body: { items: [SAMPLE_PARTNER_1] } };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(NOW)} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-confirm')).toBeTruthy();
        expect(screen.getByTestId('date-decline')).toBeTruthy();
      });

      expect(screen.queryByTestId('date-cancel')).toBeNull();

      await screen.unmount();
    });
  });

  describe('AC2: Cutoff locking and exact boundary for CONFIRMED status', () => {
    it('locks cancel button with explanation when within cutoff', async () => {
      // startsAt = 2026-11-25T09:00:00.000Z, cancelDeadline = 2026-11-25T05:00:00.000Z
      // now lúc 06:00:00.000Z (đã quá cutoff 4 tiếng trước giờ hẹn)
      const cutoffNow = '2026-11-25T06:00:00.000Z';

      const confirmedPlan: DatePlanDto = {
        ...SAMPLE_PLAN,
        status: 'CONFIRMED',
      };

      const { client, queryClient } = setupClient((url) => {
        if (url === 'http://api.test/me/match') {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        if (url === 'http://api.test/me/dates/current') {
          return { status: 200, body: { datePlan: confirmedPlan } };
        }
        if (url === 'http://api.test/partners') {
          return { status: 200, body: { items: [SAMPLE_PARTNER_1] } };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(cutoffNow)} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        const cancelBtn = screen.getByTestId('date-cancel');
        expect(cancelBtn.props.accessibilityState.disabled).toBe(true);
        expect(screen.getByTestId('date-cancel-locked-hint')).toBeTruthy();
      });

      await screen.unmount();
    });

    it('allows cancellation when now is exactly at cancelDeadline boundary', async () => {
      // exactly at cancelDeadline 05:00:00.000Z
      const boundaryNow = '2026-11-25T05:00:00.000Z';

      let cancelCalled = false;
      const confirmedPlan: DatePlanDto = {
        ...SAMPLE_PLAN,
        status: 'CONFIRMED',
      };

      const { client, queryClient } = setupClient((url, init) => {
        if (url === 'http://api.test/me/match') {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        if (url === 'http://api.test/me/dates/current') {
          return { status: 200, body: { datePlan: confirmedPlan } };
        }
        if (url === 'http://api.test/partners') {
          return { status: 200, body: { items: [SAMPLE_PARTNER_1] } };
        }
        if (url === `http://api.test/me/dates/${PLAN_ID}/cancel` && init?.method === 'POST') {
          cancelCalled = true;
          return {
            status: 200,
            body: { ...confirmedPlan, status: 'CANCELLED', cancelledAt: boundaryNow },
          };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(boundaryNow)} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        const cancelBtn = screen.getByTestId('date-cancel');
        expect(cancelBtn.props.accessibilityState.disabled).toBe(false);
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-cancel'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-cancel-ok')).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-cancel-ok'));
      });

      await waitFor(() => {
        expect(cancelCalled).toBe(true);
      });

      await screen.unmount();
    });
  });

  describe('Propose date flow', () => {
    it('disables submit when incomplete, enables when complete and sends proper body', async () => {
      let postedBody: unknown = null;
      let datePlanState: DatePlanDto | null = null;

      const { client, queryClient } = setupClient((url, init) => {
        if (url === 'http://api.test/me/match') {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        if (url === 'http://api.test/me/dates/current') {
          return { status: 200, body: { datePlan: datePlanState } };
        }
        if (url === 'http://api.test/partners') {
          return { status: 200, body: { items: [SAMPLE_PARTNER_1, SAMPLE_PARTNER_2] } };
        }
        if (url === 'http://api.test/me/dates' && init?.method === 'POST') {
          postedBody = JSON.parse(init.body as string);
          datePlanState = {
            ...SAMPLE_PLAN,
            myRole: 'INVITER',
          };
          return { status: 201, body: datePlanState };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(NOW)} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-propose')).toBeTruthy();
      });

      // Submit is initially disabled because day, slot, partner are not selected
      const proposeBtn = screen.getByTestId('date-propose');
      expect(proposeBtn.props.accessibilityState.disabled).toBe(true);

      // Select partner
      await act(async () => {
        await fireEvent.press(screen.getByTestId(`date-partner-${PARTNER_ID_1}`));
      });

      // Still disabled (need day and slot)
      expect(screen.getByTestId('date-propose').props.accessibilityState.disabled).toBe(true);

      // Select day (2026-11-25)
      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-day-2026-11-25'));
      });

      // Select slot
      await waitFor(() => {
        expect(screen.getByTestId('date-slot-morning')).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-slot-morning'));
      });

      // Toggle staff booking
      await act(async () => {
        await fireEvent(screen.getByTestId('date-staff-booking'), 'valueChange', true);
      });

      // Now propose button should be enabled
      await waitFor(() => {
        expect(screen.getByTestId('date-propose').props.accessibilityState.disabled).toBe(false);
      });

      // Submit proposal
      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-propose'));
      });

      await waitFor(() => {
        expect(postedBody).not.toBeNull();
      });

      const body = postedBody as {
        partnerId: string;
        startsAt: string;
        endsAt: string;
        staffBookingRequested: boolean;
      };

      expect(body.partnerId).toBe(PARTNER_ID_1);
      expect(body.staffBookingRequested).toBe(true);
      expect(body.startsAt).toContain('2026-11-25');
      expect(body.endsAt).toContain('2026-11-25');

      await screen.unmount();
    });
  });

  describe('Confirm and decline actions', () => {
    it('confirms date proposal successfully and displays toast', async () => {
      let confirmCalled = false;
      const { client, queryClient } = setupClient((url, init) => {
        if (url === 'http://api.test/me/match') {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        if (url === 'http://api.test/me/dates/current') {
          return { status: 200, body: { datePlan: { ...SAMPLE_PLAN, myRole: 'INVITEE' } } };
        }
        if (url === 'http://api.test/partners') {
          return { status: 200, body: { items: [SAMPLE_PARTNER_1] } };
        }
        if (url === `http://api.test/me/dates/${PLAN_ID}/confirm` && init?.method === 'POST') {
          confirmCalled = true;
          return {
            status: 200,
            body: {
              ...SAMPLE_PLAN,
              status: 'CONFIRMED',
              respondedAt: NOW,
            },
          };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(NOW)} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-confirm')).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-confirm'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-confirm-ok')).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-confirm-ok'));
      });

      await waitFor(() => {
        expect(confirmCalled).toBe(true);
        expect(screen.getByText(DATES_COPY.toasts.confirmed)).toBeTruthy();
      });

      await screen.unmount();
    });

    it('declines date proposal successfully and displays toast', async () => {
      let declineCalled = false;
      const { client, queryClient } = setupClient((url, init) => {
        if (url === 'http://api.test/me/match') {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        if (url === 'http://api.test/me/dates/current') {
          return { status: 200, body: { datePlan: { ...SAMPLE_PLAN, myRole: 'INVITEE' } } };
        }
        if (url === 'http://api.test/partners') {
          return { status: 200, body: { items: [SAMPLE_PARTNER_1] } };
        }
        if (url === `http://api.test/me/dates/${PLAN_ID}/decline` && init?.method === 'POST') {
          declineCalled = true;
          return {
            status: 200,
            body: {
              ...SAMPLE_PLAN,
              status: 'DECLINED',
              respondedAt: NOW,
            },
          };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(NOW)} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-decline')).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-decline'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-decline-ok')).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-decline-ok'));
      });

      await waitFor(() => {
        expect(declineCalled).toBe(true);
        expect(screen.getByText(DATES_COPY.toasts.declined)).toBeTruthy();
      });

      await screen.unmount();
    });
  });

  describe('Error codes handling', () => {
    it.each([
      { code: 'MATCH_NOT_DATING', status: 409 },
      { code: 'DATE_ALREADY_OPEN', status: 409 },
      { code: 'DATE_TIME_INVALID', status: 422 },
      { code: 'DATE_RESPONSE_EXPIRED', status: 409 },
    ])('displays error title toast for $code when proposing', async ({ code, status }) => {
      const { client, queryClient } = setupClient((url, init) => {
        if (url === 'http://api.test/me/match') {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        if (url === 'http://api.test/me/dates/current') {
          return { status: 200, body: { datePlan: null } };
        }
        if (url === 'http://api.test/partners') {
          return { status: 200, body: { items: [SAMPLE_PARTNER_1] } };
        }
        if (url === 'http://api.test/me/dates' && init?.method === 'POST') {
          return {
            status,
            body: createProblemBody({ code, status }),
          };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(NOW)} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-partner-01890a5d-ac96-774b-bcce-b302099a8011')).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-partner-01890a5d-ac96-774b-bcce-b302099a8011'));
        await fireEvent.press(screen.getByTestId('date-day-2026-11-25'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-slot-morning')).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-slot-morning'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-propose').props.accessibilityState.disabled).toBe(false);
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-propose'));
      });

      await waitFor(() => {
        expect(screen.getByText(messageFor({ code, status }).title)).toBeTruthy();
      });

      await screen.unmount();
    });

    it('displays custom cancelTooLate toast when cancel responds with CANCEL_TOO_LATE', async () => {
      const confirmedPlan: DatePlanDto = {
        ...SAMPLE_PLAN,
        status: 'CONFIRMED',
      };

      const { client, queryClient } = setupClient((url, init) => {
        if (url === 'http://api.test/me/match') {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        if (url === 'http://api.test/me/dates/current') {
          return { status: 200, body: { datePlan: confirmedPlan } };
        }
        if (url === 'http://api.test/partners') {
          return { status: 200, body: { items: [SAMPLE_PARTNER_1] } };
        }
        if (url === `http://api.test/me/dates/${PLAN_ID}/cancel` && init?.method === 'POST') {
          return {
            status: 409,
            body: createProblemBody({
              code: 'CANCEL_TOO_LATE',
              status: 409,
              title: 'Lỗi chung phỏng vấn',
            }),
          };
        }
        return { status: 404 };
      });

      // Clock set before deadline so button is enabled
      const screen = await renderWithProviders(
        <DatesScreen clock={createFixedClock('2026-11-25T04:00:00.000Z')} />,
        { client, queryClient },
      );

      await waitFor(() => {
        expect(screen.getByTestId('date-cancel')).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-cancel'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-cancel-ok')).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByTestId('date-cancel-ok'));
      });

      const expectedText = DATES_COPY.errors.cancelTooLate(DATE_CANCEL_CUTOFF_HOURS);
      await waitFor(() => {
        expect(screen.getByText(expectedText)).toBeTruthy();
      });

      await screen.unmount();
    });
  });

  describe('Foreground Push Notification', () => {
    it('refetches current date plan when DATE_CONFIRMED push arrives', async () => {
      let fetchCount = 0;
      const { client, queryClient } = setupClient((url) => {
        if (url === 'http://api.test/me/match') {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        if (url === 'http://api.test/me/dates/current') {
          fetchCount++;
          return { status: 200, body: { datePlan: SAMPLE_PLAN } };
        }
        if (url === 'http://api.test/partners') {
          return { status: 200, body: { items: [SAMPLE_PARTNER_1] } };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(NOW)} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(fetchCount).toBe(1);
      });

      // Simulate push notification arrival
      expect(notificationListener).not.toBeNull();
      await act(async () => {
        notificationListener?.({
          request: {
            content: {
              data: {
                kind: 'DATE_CONFIRMED',
                datePlanId: PLAN_ID,
              },
            },
          },
        });
      });

      await waitFor(() => {
        expect(fetchCount).toBeGreaterThanOrEqual(2);
      });

      await screen.unmount();
    });
  });

  it('GET /me/match lỗi và chưa có lịch → ErrorState, không hiện "chưa thể đặt lịch"', async () => {
    let failing = true;
    const { client, queryClient } = setupClient((url) => {
      if (url === 'http://api.test/me/match') {
        return failing
          ? { status: 500, body: createProblemBody({ code: 'INTERNAL_ERROR', status: 500 }) }
          : { status: 200, body: { match: SAMPLE_MATCH } };
      }
      if (url === 'http://api.test/me/dates/current') return { status: 200, body: { datePlan: null } };
      if (url === 'http://api.test/partners') return { status: 200, body: { items: [SAMPLE_PARTNER_1] } };
      return { status: 404 };
    });
    const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(NOW)} />, {
      client,
      queryClient,
    });
    await waitFor(() => {
      expect(screen.getByText(messageFor({ code: 'INTERNAL_ERROR', status: 500 }).title)).toBeTruthy();
    });
    expect(screen.queryByText(DATES_COPY.notDating.title)).toBeNull();

    failing = false;
    await fireEvent.press(screen.getByLabelText('Thử lại'));
    await waitFor(() => {
      expect(screen.getByTestId('date-propose')).toBeTruthy();
    });
    await screen.unmount();
  });

  describe('Banned content check (FE-D5 / FE-D6)', () => {
    it('contains no forbidden phrases or words in rendered text', async () => {
      const { client, queryClient } = setupClient((url) => {
        if (url === 'http://api.test/me/match') {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        if (url === 'http://api.test/me/dates/current') {
          return { status: 200, body: { datePlan: null } };
        }
        if (url === 'http://api.test/partners') {
          return { status: 200, body: { items: [SAMPLE_PARTNER_1] } };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<DatesScreen clock={createFixedClock(NOW)} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByTestId('date-propose')).toBeTruthy();
      });

      const forbiddenRegex = /%|eKYC|300|cả hai.*voucher|Mai Hương/i;
      expect(screen.queryByText(forbiddenRegex)).toBeNull();

      await screen.unmount();
    });
  });
});
