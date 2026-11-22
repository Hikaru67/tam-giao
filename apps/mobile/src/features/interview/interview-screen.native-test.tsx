import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import { INTERVIEW_CHANGE_CUTOFF_HOURS, INTERVIEW_DURATION_MINUTES } from '@tamgiao/contracts/constants';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { createFixedClock } from './clock.js';
import { INTERVIEW_ROUTE } from './constants.js';
import { INTERVIEW_COPY } from './copy.js';
import { InterviewEntryCard } from './interview-entry-card.js';
import { InterviewScreen } from './interview-screen.js';
import {
  changeDeadlineOf,
  formatLocalDate,
  formatLocalTime,
  type AvailableInterviewSlot,
} from './interview-time.js';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => ({}),
}));

const NOW = '2026-11-23T03:00:00.000Z';
const SLOT_ID_1 = '01952e46-953b-789a-b283-a9d701897d26';
const SLOT_ID_2 = '01952e46-953b-789a-b283-a9d701897d27';
const SLOT_ID_3 = '01952e46-953b-789a-b283-a9d701897d28';

describe('InterviewScreen (FE-S3-03)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('a. groups available slots by local day', async () => {
    const slot1: AvailableInterviewSlot = {
      id: SLOT_ID_1,
      startsAt: '2026-11-24T04:00:00.000Z',
      endsAt: '2026-11-24T04:15:00.000Z',
    };
    const slot2: AvailableInterviewSlot = {
      id: SLOT_ID_2,
      startsAt: '2026-11-24T04:30:00.000Z',
      endsAt: '2026-11-24T04:45:00.000Z',
    };
    const slot3: AvailableInterviewSlot = {
      id: SLOT_ID_3,
      startsAt: '2026-11-25T04:00:00.000Z',
      endsAt: '2026-11-25T04:15:00.000Z',
    };

    const fakeFetch = createFakeFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === 'http://api.test/me/kyc/interview' && method === 'GET') {
        return { status: 200, body: { booking: null } };
      }
      if (url.startsWith('http://api.test/me/kyc/interview/slots') && method === 'GET') {
        return { status: 200, body: { items: [slot1, slot2, slot3] } };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<InterviewScreen clock={createFixedClock(NOW)} />, {
      client,
      queryClient,
    });

    const d1 = new Date(slot1.startsAt);
    const localD1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const expectedDay1 = INTERVIEW_COPY.picker.dayLabel(
      INTERVIEW_COPY.picker.weekdays[localD1.getDay()] ?? '',
      formatLocalDate(localD1),
    );

    const d3 = new Date(slot3.startsAt);
    const localD3 = new Date(d3.getFullYear(), d3.getMonth(), d3.getDate());
    const expectedDay2 = INTERVIEW_COPY.picker.dayLabel(
      INTERVIEW_COPY.picker.weekdays[localD3.getDay()] ?? '',
      formatLocalDate(localD3),
    );

    await waitFor(() => {
      expect(screen.getByText(expectedDay1)).toBeTruthy();
      expect(screen.getByText(expectedDay2)).toBeTruthy();
      expect(screen.getByTestId(`interview-slot-${SLOT_ID_1}`)).toBeTruthy();
      expect(screen.getByTestId(`interview-slot-${SLOT_ID_2}`)).toBeTruthy();
      expect(screen.getByTestId(`interview-slot-${SLOT_ID_3}`)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('b. books a slot', async () => {
    let postBody: unknown = null;
    const fakeFetch = createFakeFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === 'http://api.test/me/kyc/interview' && method === 'GET') {
        return { status: 200, body: { booking: null } };
      }
      if (url.startsWith('http://api.test/me/kyc/interview/slots') && method === 'GET') {
        return {
          status: 200,
          body: {
            items: [
              {
                id: SLOT_ID_1,
                startsAt: '2026-11-25T04:00:00.000Z',
                endsAt: '2026-11-25T04:15:00.000Z',
              },
            ],
          },
        };
      }
      if (url === 'http://api.test/me/kyc/interview' && method === 'POST') {
        postBody = init?.body ? JSON.parse(init.body as string) : null;
        return {
          status: 201,
          body: {
            booking: {
              slotId: SLOT_ID_1,
              startsAt: '2026-11-25T04:00:00.000Z',
              endsAt: '2026-11-25T04:15:00.000Z',
              meetingUrl: null,
              changeDeadline: '2026-11-25T02:00:00.000Z',
              canChange: true,
            },
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<InterviewScreen clock={createFixedClock(NOW)} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId(`interview-slot-${SLOT_ID_1}`)).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId(`interview-slot-${SLOT_ID_1}`));
    });

    const submitBtn = screen.getByTestId('interview-submit');
    await act(async () => {
      await fireEvent.press(submitBtn);
    });

    expect(postBody).toEqual({ slotId: SLOT_ID_1 });

    await waitFor(() => {
      expect(screen.getByTestId('interview-booking')).toBeTruthy();
      expect(
        screen.getByText(
          INTERVIEW_COPY.booking.when(
            formatLocalDate('2026-11-25T04:00:00.000Z'),
            formatLocalTime('2026-11-25T04:00:00.000Z'),
            formatLocalTime('2026-11-25T04:15:00.000Z'),
          ),
        ),
      ).toBeTruthy();
    });

    const cancelBtn = screen.getByTestId('interview-cancel');
    expect(cancelBtn.props.accessibilityState?.disabled).toBe(false);

    await screen.unmount();
  });

  it('c. slot taken → shows message and refreshes the list', async () => {
    let getSlotsCallCount = 0;
    const fakeFetch = createFakeFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === 'http://api.test/me/kyc/interview' && method === 'GET') {
        return { status: 200, body: { booking: null } };
      }
      if (url.startsWith('http://api.test/me/kyc/interview/slots') && method === 'GET') {
        getSlotsCallCount++;
        if (getSlotsCallCount === 1) {
          return {
            status: 200,
            body: {
              items: [
                {
                  id: SLOT_ID_1,
                  startsAt: '2026-11-25T04:00:00.000Z',
                  endsAt: '2026-11-25T04:15:00.000Z',
                },
              ],
            },
          };
        }
        return { status: 200, body: { items: [] } };
      }
      if (url === 'http://api.test/me/kyc/interview' && method === 'POST') {
        return {
          status: 409,
          body: createProblemBody({
            code: 'SLOT_TAKEN',
            status: 409,
            title: 'Khung giờ phỏng vấn đã có người đặt',
          }),
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<InterviewScreen clock={createFixedClock(NOW)} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId(`interview-slot-${SLOT_ID_1}`)).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId(`interview-slot-${SLOT_ID_1}`));
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('interview-submit'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('interview-error')).toBeTruthy();
      expect(screen.getByText(INTERVIEW_COPY.toast.slotTaken)).toBeTruthy();
    });

    expect(screen.queryByTestId(`interview-slot-${SLOT_ID_1}`)).toBeNull();
    expect(getSlotsCallCount).toBeGreaterThanOrEqual(2);

    const submitBtn = screen.getByTestId('interview-submit');
    expect(submitBtn.props.accessibilityState?.disabled).toBe(true);

    await screen.unmount();
  });

  it('d. AC1: cancel/reschedule locked within cutoff', async () => {
    let deleteCalls = 0;
    const startsAt = new Date(
      Date.parse(NOW) + (INTERVIEW_CHANGE_CUTOFF_HOURS * 60 - 30) * 60_000,
    ).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + INTERVIEW_DURATION_MINUTES * 60_000).toISOString();
    const changeDeadline = changeDeadlineOf(startsAt).toISOString();

    const fakeFetch = createFakeFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === 'http://api.test/me/kyc/interview' && method === 'GET') {
        return {
          status: 200,
          body: {
            booking: {
              slotId: SLOT_ID_1,
              startsAt,
              endsAt,
              meetingUrl: null,
              changeDeadline,
              canChange: false,
            },
          },
        };
      }
      if (url === 'http://api.test/me/kyc/interview' && method === 'DELETE') {
        deleteCalls++;
        return { status: 200, body: { booking: null } };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<InterviewScreen clock={createFixedClock(NOW)} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('interview-locked-hint')).toBeTruthy();
      expect(screen.getByText(INTERVIEW_COPY.booking.lockedHint(INTERVIEW_CHANGE_CUTOFF_HOURS))).toBeTruthy();
    });

    const cancelBtn = screen.getByTestId('interview-cancel');
    const rescheduleBtn = screen.getByTestId('interview-reschedule');
    expect(cancelBtn.props.accessibilityState?.disabled).toBe(true);
    expect(rescheduleBtn.props.accessibilityState?.disabled).toBe(true);

    await act(async () => {
      await fireEvent.press(cancelBtn);
    });

    expect(deleteCalls).toBe(0);

    await screen.unmount();
  });

  it('e. locks by injected clock even when server canChange is true', async () => {
    const startsAt = new Date(
      Date.parse(NOW) + (INTERVIEW_CHANGE_CUTOFF_HOURS * 60 - 30) * 60_000,
    ).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + INTERVIEW_DURATION_MINUTES * 60_000).toISOString();
    const changeDeadline = changeDeadlineOf(startsAt).toISOString();

    const fakeFetch = createFakeFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === 'http://api.test/me/kyc/interview' && method === 'GET') {
        return {
          status: 200,
          body: {
            booking: {
              slotId: SLOT_ID_1,
              startsAt,
              endsAt,
              meetingUrl: null,
              changeDeadline,
              canChange: true,
            },
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<InterviewScreen clock={createFixedClock(NOW)} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('interview-locked-hint')).toBeTruthy();
    });

    const cancelBtn = screen.getByTestId('interview-cancel');
    const rescheduleBtn = screen.getByTestId('interview-reschedule');
    expect(cancelBtn.props.accessibilityState?.disabled).toBe(true);
    expect(rescheduleBtn.props.accessibilityState?.disabled).toBe(true);

    await screen.unmount();
  });

  it('f. cancels outside cutoff', async () => {
    const startsAt = new Date(Date.parse(NOW) + 24 * 3_600_000).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + INTERVIEW_DURATION_MINUTES * 60_000).toISOString();
    const changeDeadline = changeDeadlineOf(startsAt).toISOString();

    let deleteCalls = 0;
    const fakeFetch = createFakeFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === 'http://api.test/me/kyc/interview' && method === 'GET') {
        return {
          status: 200,
          body: {
            booking: {
              slotId: SLOT_ID_1,
              startsAt,
              endsAt,
              meetingUrl: null,
              changeDeadline,
              canChange: true,
            },
          },
        };
      }
      if (url.startsWith('http://api.test/me/kyc/interview/slots') && method === 'GET') {
        return { status: 200, body: { items: [] } };
      }
      if (url === 'http://api.test/me/kyc/interview' && method === 'DELETE') {
        deleteCalls++;
        return { status: 200, body: { booking: null } };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<InterviewScreen clock={createFixedClock(NOW)} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('interview-change-hint')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('interview-cancel'));
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('interview-cancel-confirm'));
    });

    expect(deleteCalls).toBe(1);

    await waitFor(() => {
      expect(screen.getByText(INTERVIEW_COPY.picker.title)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('g. server rejects cancel with CANCEL_TOO_LATE', async () => {
    const startsAt = new Date(Date.parse(NOW) + 24 * 3_600_000).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + INTERVIEW_DURATION_MINUTES * 60_000).toISOString();
    const changeDeadline = changeDeadlineOf(startsAt).toISOString();

    const fakeFetch = createFakeFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === 'http://api.test/me/kyc/interview' && method === 'GET') {
        return {
          status: 200,
          body: {
            booking: {
              slotId: SLOT_ID_1,
              startsAt,
              endsAt,
              meetingUrl: null,
              changeDeadline,
              canChange: true,
            },
          },
        };
      }
      if (url === 'http://api.test/me/kyc/interview' && method === 'DELETE') {
        return {
          status: 409,
          body: createProblemBody({
            code: 'CANCEL_TOO_LATE',
            status: 409,
            title: 'Đã quá hạn huỷ/đổi lịch phỏng vấn',
          }),
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<InterviewScreen clock={createFixedClock(NOW)} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('interview-cancel')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('interview-cancel'));
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('interview-cancel-confirm'));
    });

    const expectedTitle = messageFor({ code: 'CANCEL_TOO_LATE' }).title;
    await waitFor(() => {
      expect(screen.getByText(expectedTitle)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('h. reschedules to another slot', async () => {
    let putBody: unknown = null;
    const startsAt1 = new Date(Date.parse(NOW) + 24 * 3_600_000).toISOString();
    const endsAt1 = new Date(Date.parse(startsAt1) + INTERVIEW_DURATION_MINUTES * 60_000).toISOString();
    const deadline1 = changeDeadlineOf(startsAt1).toISOString();

    const startsAt2 = new Date(Date.parse(NOW) + 48 * 3_600_000).toISOString();
    const endsAt2 = new Date(Date.parse(startsAt2) + INTERVIEW_DURATION_MINUTES * 60_000).toISOString();
    const deadline2 = changeDeadlineOf(startsAt2).toISOString();

    const fakeFetch = createFakeFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === 'http://api.test/me/kyc/interview' && method === 'GET') {
        return {
          status: 200,
          body: {
            booking: {
              slotId: SLOT_ID_1,
              startsAt: startsAt1,
              endsAt: endsAt1,
              meetingUrl: null,
              changeDeadline: deadline1,
              canChange: true,
            },
          },
        };
      }
      if (url.startsWith('http://api.test/me/kyc/interview/slots') && method === 'GET') {
        return {
          status: 200,
          body: {
            items: [
              { id: SLOT_ID_1, startsAt: startsAt1, endsAt: endsAt1 },
              { id: SLOT_ID_2, startsAt: startsAt2, endsAt: endsAt2 },
            ],
          },
        };
      }
      if (url === 'http://api.test/me/kyc/interview' && method === 'PUT') {
        putBody = init?.body ? JSON.parse(init.body as string) : null;
        return {
          status: 200,
          body: {
            booking: {
              slotId: SLOT_ID_2,
              startsAt: startsAt2,
              endsAt: endsAt2,
              meetingUrl: null,
              changeDeadline: deadline2,
              canChange: true,
            },
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<InterviewScreen clock={createFixedClock(NOW)} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('interview-reschedule')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('interview-reschedule'));
    });

    await waitFor(() => {
      expect(screen.getByText(INTERVIEW_COPY.picker.rescheduleTitle)).toBeTruthy();
      expect(screen.queryByTestId(`interview-slot-${SLOT_ID_1}`)).toBeNull();
      expect(screen.getByTestId(`interview-slot-${SLOT_ID_2}`)).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId(`interview-slot-${SLOT_ID_2}`));
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('interview-submit'));
    });

    expect(putBody).toEqual({ slotId: SLOT_ID_2 });

    await waitFor(() => {
      expect(screen.getByTestId('interview-booking')).toBeTruthy();
      expect(
        screen.getByText(
          INTERVIEW_COPY.booking.when(
            formatLocalDate(startsAt2),
            formatLocalTime(startsAt2),
            formatLocalTime(endsAt2),
          ),
        ),
      ).toBeTruthy();
    });

    await screen.unmount();
  });

  describe('InterviewEntryCard', () => {
    it('renders empty state when not booked and navigates on CTA press', async () => {
      const fakeFetch = createFakeFetch((url, init) => {
        const method = init?.method ?? 'GET';
        if (url === 'http://api.test/me/kyc/interview' && method === 'GET') {
          return { status: 200, body: { booking: null } };
        }
        return { status: 404 };
      });

      const client = createApiClient({
        baseUrl: 'http://api.test',
        tokenStore: createMemoryTokenStore(),
        fetch: fakeFetch,
      });
      const queryClient = createTestQueryClient();

      const screen = await renderWithProviders(<InterviewEntryCard />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByTestId('interview-entry-card')).toBeTruthy();
        expect(screen.getByText(INTERVIEW_COPY.entry.title)).toBeTruthy();
        expect(screen.getByText(INTERVIEW_COPY.entry.notBooked)).toBeTruthy();
        expect(screen.getByText(INTERVIEW_COPY.entry.bookCta)).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByText(INTERVIEW_COPY.entry.bookCta));
      });

      expect(mockPush).toHaveBeenCalledWith(INTERVIEW_ROUTE);

      await screen.unmount();
    });

    it('renders booked state when booking exists and navigates on CTA press', async () => {
      const startsAt = '2026-11-25T04:00:00.000Z';
      const endsAt = '2026-11-25T04:15:00.000Z';
      const fakeFetch = createFakeFetch((url, init) => {
        const method = init?.method ?? 'GET';
        if (url === 'http://api.test/me/kyc/interview' && method === 'GET') {
          return {
            status: 200,
            body: {
              booking: {
                slotId: SLOT_ID_1,
                startsAt,
                endsAt,
                meetingUrl: null,
                changeDeadline: '2026-11-25T02:00:00.000Z',
                canChange: true,
              },
            },
          };
        }
        return { status: 404 };
      });

      const client = createApiClient({
        baseUrl: 'http://api.test',
        tokenStore: createMemoryTokenStore(),
        fetch: fakeFetch,
      });
      const queryClient = createTestQueryClient();

      const screen = await renderWithProviders(<InterviewEntryCard />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByTestId('interview-entry-card')).toBeTruthy();
        expect(screen.getByText(INTERVIEW_COPY.entry.title)).toBeTruthy();
        expect(
          screen.getByText(INTERVIEW_COPY.entry.booked(formatLocalDate(startsAt), formatLocalTime(startsAt))),
        ).toBeTruthy();
        expect(screen.getByText(INTERVIEW_COPY.entry.viewCta)).toBeTruthy();
      });

      await act(async () => {
        await fireEvent.press(screen.getByText(INTERVIEW_COPY.entry.viewCta));
      });

      expect(mockPush).toHaveBeenCalledWith(INTERVIEW_ROUTE);

      await screen.unmount();
    });
  });
});
