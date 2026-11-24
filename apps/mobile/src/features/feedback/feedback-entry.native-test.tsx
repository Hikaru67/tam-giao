import { createApiClient, createMemoryTokenStore } from '@tamgiao/api-client';
import type { DatePlanDto, MyFeedbackDto } from '@tamgiao/contracts/dating';
import { fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import type { DateView } from '../dates/date-view.js';
import { FEEDBACK_COPY } from './copy.js';
import { FeedbackEntry } from './feedback-entry.js';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const PLAN_ID = '01890a5d-ac96-774b-bcce-b302099a8001';
const MATCH_ID = '01890a5d-ac96-774b-bcce-b302099a8002';
const USER_A_ID = '01890a5d-ac96-774b-bcce-b302099a8003';
const USER_B_ID = '01890a5d-ac96-774b-bcce-b302099a8004';
const PARTNER_ID = '01890a5d-ac96-774b-bcce-b302099a8005';
const FEEDBACK_ID = '01890a5d-ac96-774b-bcce-b302099a8006';

const BASE_PLAN: DatePlanDto = {
  id: PLAN_ID,
  matchId: MATCH_ID,
  inviterId: USER_A_ID,
  inviteeId: USER_B_ID,
  myRole: 'INVITER',
  partnerId: PARTNER_ID,
  startsAt: '2026-11-24T10:00:00.000Z',
  endsAt: '2026-11-24T12:00:00.000Z',
  staffBookingRequested: false,
  status: 'CONFIRMED',
  expiresAt: '2026-11-23T10:00:00.000Z',
  proposedAt: '2026-11-22T10:00:00.000Z',
  respondedAt: '2026-11-22T11:00:00.000Z',
  cancelledAt: null,
  cancelledBy: null,
  cancelDeadline: '2026-11-24T06:00:00.000Z',
};

const SAMPLE_MY_FEEDBACK: MyFeedbackDto = {
  id: FEEDBACK_ID,
  datePlanId: PLAN_ID,
  matchId: MATCH_ID,
  rating: 5,
  profileMatch: 'FULL_MATCH',
  feeling: 'DEEP_INTEREST',
  decision: 'A_COMMIT',
  stopReasons: [],
  stopNote: null,
  submittedAt: '2026-11-24T12:30:00.000Z',
};

function setupClient(feedback: MyFeedbackDto | null = null) {
  const fakeFetch = createFakeFetch((url) => {
    if (url.includes(`/me/dates/${PLAN_ID}/feedback`)) {
      return { status: 200, body: { feedback } };
    }
    return { status: 404 };
  });
  const client = createApiClient({
    baseUrl: 'http://api.test',
    tokenStore: createMemoryTokenStore(),
    fetch: fakeFetch,
  });
  const queryClient = createTestQueryClient();
  return { client, queryClient };
}

describe('FeedbackEntry (FE-S5-04)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null for views outside {in_progress, awaiting_feedback, completed}', async () => {
    const { client, queryClient } = setupClient(null);

    const outsideViews: DateView[] = [
      { kind: 'none', canRespond: false, canCancel: false, cancelLocked: false, canProposeNew: true },
      {
        kind: 'proposed_inviter',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      {
        kind: 'proposed_invitee',
        canRespond: true,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      {
        kind: 'proposed_expired',
        canRespond: false,
        canCancel: false,
        cancelLocked: false,
        canProposeNew: false,
      },
      { kind: 'confirmed', canRespond: false, canCancel: true, cancelLocked: false, canProposeNew: false },
      { kind: 'ended', canRespond: false, canCancel: false, cancelLocked: false, canProposeNew: true },
    ];

    for (const view of outsideViews) {
      const screen = await renderWithProviders(<FeedbackEntry plan={BASE_PLAN} view={view} />, {
        client,
        queryClient,
      });
      expect(screen.queryByTestId('date-feedback')).toBeNull();
      await screen.unmount();
    }
  });

  it('renders button for in_progress and navigates on press', async () => {
    const { client, queryClient } = setupClient(null);

    const inProgressView: DateView = {
      kind: 'in_progress',
      canRespond: false,
      canCancel: false,
      cancelLocked: false,
      canProposeNew: false,
    };

    const screen = await renderWithProviders(
      <FeedbackEntry plan={{ ...BASE_PLAN, status: 'CHECKED_IN' }} view={inProgressView} />,
      { client, queryClient },
    );

    const btn = screen.getByTestId('date-feedback');
    expect(btn).toBeTruthy();
    expect(screen.getByText(FEEDBACK_COPY.entry.giveFeedback)).toBeTruthy();

    await fireEvent.press(btn);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(main)/dates/feedback',
      params: { datePlanId: PLAN_ID },
    });

    await screen.unmount();
  });

  it('renders button for awaiting_feedback', async () => {
    const { client, queryClient } = setupClient(null);

    const awaitingView: DateView = {
      kind: 'awaiting_feedback',
      canRespond: false,
      canCancel: false,
      cancelLocked: false,
      canProposeNew: false,
    };

    const screen = await renderWithProviders(<FeedbackEntry plan={BASE_PLAN} view={awaitingView} />, {
      client,
      queryClient,
    });

    expect(screen.getByTestId('date-feedback')).toBeTruthy();
    expect(screen.getByText(FEEDBACK_COPY.entry.giveFeedback)).toBeTruthy();

    await screen.unmount();
  });

  it('shows "Xem đánh giá của bạn" when completed and feedback already submitted', async () => {
    const { client, queryClient } = setupClient(SAMPLE_MY_FEEDBACK);

    const completedView: DateView = {
      kind: 'completed',
      canRespond: false,
      canCancel: false,
      cancelLocked: false,
      canProposeNew: false,
    };

    const screen = await renderWithProviders(
      <FeedbackEntry plan={{ ...BASE_PLAN, status: 'COMPLETED' }} view={completedView} />,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText(FEEDBACK_COPY.entry.viewFeedback)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('shows "Đánh giá buổi gặp" when completed but feedback not yet submitted', async () => {
    const { client, queryClient } = setupClient(null);

    const completedView: DateView = {
      kind: 'completed',
      canRespond: false,
      canCancel: false,
      cancelLocked: false,
      canProposeNew: false,
    };

    const screen = await renderWithProviders(
      <FeedbackEntry plan={{ ...BASE_PLAN, status: 'COMPLETED' }} view={completedView} />,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText(FEEDBACK_COPY.entry.giveFeedback)).toBeTruthy();
    });

    await screen.unmount();
  });
});
