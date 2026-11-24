import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import { COOLDOWN_DAYS } from '@tamgiao/contracts/constants';
import type { MyFeedbackDto } from '@tamgiao/contracts/dating';
import type { CurrentMatchDto } from '@tamgiao/contracts/matching';
import { fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import {
  FEEDBACK_COPY,
  FEEDBACK_DECISION_COPY,
  FEEDBACK_FEELING_COPY,
  FEEDBACK_PROFILE_MATCH_COPY,
  FEEDBACK_STOP_REASON_COPY,
} from './copy.js';
import { FeedbackScreen } from './feedback-screen.js';

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
}));

const DATE_PLAN_ID = '01890a5d-ac96-774b-bcce-b302099a8001';
const MATCH_ID = '01890a5d-ac96-774b-bcce-b302099a8002';
const USER_PEER_ID = '01890a5d-ac96-774b-bcce-b302099a8003';
const FEEDBACK_ID = '01890a5d-ac96-774b-bcce-b302099a8004';

const SAMPLE_MATCH: CurrentMatchDto = {
  matchId: MATCH_ID,
  status: 'DATING',
  phase: 'DATING',
  offeredAt: '2026-11-20T00:00:00.000Z',
  datingStartedAt: '2026-11-21T00:00:00.000Z',
  score: null,
  commonPoints: [],
  staffNote: null,
  counterpart: {
    userId: USER_PEER_ID,
    displayName: 'Minh Trang',
    age: 28,
    currentCity: 'TP. Hồ Chí Minh',
    occupation: 'Kiểm toán',
    education: 'bachelor',
    avatar: null,
  },
  expiresAt: '2026-12-05T00:00:00.000Z',
};

const SAMPLE_FEEDBACK_A: MyFeedbackDto = {
  id: FEEDBACK_ID,
  datePlanId: DATE_PLAN_ID,
  matchId: MATCH_ID,
  rating: 5,
  profileMatch: 'FULL_MATCH',
  feeling: 'DEEP_INTEREST',
  decision: 'A_COMMIT',
  stopReasons: [],
  stopNote: null,
  submittedAt: '2026-11-24T12:00:00.000Z',
};

const SAMPLE_FEEDBACK_B: MyFeedbackDto = {
  id: FEEDBACK_ID,
  datePlanId: DATE_PLAN_ID,
  matchId: MATCH_ID,
  rating: 2,
  profileMatch: 'DIFFERENT',
  feeling: 'NOT_A_FIT',
  decision: 'B_STOP',
  stopReasons: ['NO_SPARK', 'LIFESTYLE_DIFFERENCE'],
  stopNote: 'Cần thêm thời gian cân bằng',
  submittedAt: '2026-11-24T12:00:00.000Z',
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

describe('FeedbackScreen (FE-S5-04)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. disables submit button when form is incomplete and enables when complete', async () => {
    const { client, queryClient } = setupClient((url) => {
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
        return { status: 200, body: { feedback: null } };
      }
      if (url.includes('/me/match')) {
        return { status: 200, body: { match: SAMPLE_MATCH } };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit')).toBeTruthy();
    });

    // Ban đầu chưa chọn gì → disabled
    expect(screen.getByTestId('feedback-submit').props.accessibilityState.disabled).toBe(true);

    // Chọn sao
    await fireEvent.press(screen.getByTestId('feedback-star-5'));
    expect(screen.getByTestId('feedback-submit').props.accessibilityState.disabled).toBe(true);

    // Chọn profileMatch
    await fireEvent.press(screen.getByTestId('feedback-profileMatch-FULL_MATCH'));
    expect(screen.getByTestId('feedback-submit').props.accessibilityState.disabled).toBe(true);

    // Chọn feeling
    await fireEvent.press(screen.getByTestId('feedback-feeling-DEEP_INTEREST'));
    expect(screen.getByTestId('feedback-submit').props.accessibilityState.disabled).toBe(true);

    // Chọn decision A_COMMIT → đầy đủ → enabled!
    await fireEvent.press(screen.getByTestId('feedback-decision-A_COMMIT'));
    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit').props.accessibilityState.disabled).toBe(false);
    });

    await screen.unmount();
  });

  it('2. AC1: sends body with stopReasons [] and stopNote null for A_COMMIT even if entered before switching', async () => {
    let capturedBody: unknown = null;

    const { client, queryClient } = setupClient((url, init) => {
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`) && init?.method === 'POST') {
        capturedBody = JSON.parse(init.body as string);
        return { status: 201, body: SAMPLE_FEEDBACK_A };
      }
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
        return { status: 200, body: { feedback: null } };
      }
      if (url.includes('/me/match')) {
        return { status: 200, body: { match: SAMPLE_MATCH } };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit')).toBeTruthy();
    });

    // Chọn sao, profileMatch, feeling
    await fireEvent.press(screen.getByTestId('feedback-star-4'));
    await fireEvent.press(screen.getByTestId('feedback-profileMatch-MOSTLY_MATCH'));
    await fireEvent.press(screen.getByTestId('feedback-feeling-NEED_MORE_TIME'));

    // Trước tiên chọn B_STOP
    await fireEvent.press(screen.getByTestId('feedback-decision-B_STOP'));

    // Nhập lý do và ghi chú
    await waitFor(() => {
      expect(screen.getByTestId('feedback-reason-LIFESTYLE_DIFFERENCE')).toBeTruthy();
    });
    await fireEvent.press(screen.getByTestId('feedback-reason-LIFESTYLE_DIFFERENCE'));
    await fireEvent.changeText(screen.getByTestId('feedback-note'), 'Ghi chú nhập trước khi đổi sang A');

    // Đổi về A_COMMIT (khối lý do & ghi chú bị ẩn)
    await fireEvent.press(screen.getByTestId('feedback-decision-A_COMMIT'));
    expect(screen.queryByTestId('feedback-reason-LIFESTYLE_DIFFERENCE')).toBeNull();

    // Bấm gửi và xác nhận trong BottomSheet
    await fireEvent.press(screen.getByTestId('feedback-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit-ok')).toBeTruthy();
    });
    await fireEvent.press(screen.getByTestId('feedback-submit-ok'));

    await waitFor(() => {
      expect(capturedBody).not.toBeNull();
    });

    expect(capturedBody).toEqual({
      rating: 4,
      profileMatch: 'MOSTLY_MATCH',
      feeling: 'NEED_MORE_TIME',
      decision: 'A_COMMIT',
      stopReasons: [],
      stopNote: null,
    });

    await screen.unmount();
  });

  it('3. sends body with stopReasons and trimmed stopNote for B_STOP', async () => {
    let capturedBody: unknown = null;

    const { client, queryClient } = setupClient((url, init) => {
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`) && init?.method === 'POST') {
        capturedBody = JSON.parse(init.body as string);
        return { status: 201, body: SAMPLE_FEEDBACK_B };
      }
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
        return { status: 200, body: { feedback: null } };
      }
      if (url.includes('/me/match')) {
        return { status: 200, body: { match: SAMPLE_MATCH } };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit')).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId('feedback-star-2'));
    await fireEvent.press(screen.getByTestId('feedback-profileMatch-DIFFERENT'));
    await fireEvent.press(screen.getByTestId('feedback-feeling-NOT_A_FIT'));
    await fireEvent.press(screen.getByTestId('feedback-decision-B_STOP'));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-reason-NO_SPARK')).toBeTruthy();
    });
    await fireEvent.press(screen.getByTestId('feedback-reason-NO_SPARK'));
    await fireEvent.press(screen.getByTestId('feedback-reason-LIFESTYLE_DIFFERENCE'));
    await fireEvent.changeText(screen.getByTestId('feedback-note'), '   Khác biệt về định hướng lối sống   ');

    await fireEvent.press(screen.getByTestId('feedback-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit-ok')).toBeTruthy();
    });
    await fireEvent.press(screen.getByTestId('feedback-submit-ok'));

    await waitFor(() => {
      expect(capturedBody).not.toBeNull();
    });

    expect(capturedBody).toEqual({
      rating: 2,
      profileMatch: 'DIFFERENT',
      feeling: 'NOT_A_FIT',
      decision: 'B_STOP',
      stopReasons: ['NO_SPARK', 'LIFESTYLE_DIFFERENCE'],
      stopNote: 'Khác biệt về định hướng lối sống',
    });

    await screen.unmount();
  });

  it('4. locks submit button and shows error when note is too long (counting code points)', async () => {
    const { client, queryClient } = setupClient((url) => {
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
        return { status: 200, body: { feedback: null } };
      }
      if (url.includes('/me/match')) {
        return { status: 200, body: { match: SAMPLE_MATCH } };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit')).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId('feedback-star-3'));
    await fireEvent.press(screen.getByTestId('feedback-profileMatch-MOSTLY_MATCH'));
    await fireEvent.press(screen.getByTestId('feedback-feeling-NEED_MORE_TIME'));
    await fireEvent.press(screen.getByTestId('feedback-decision-B_STOP'));

    await waitFor(() => {
      expect(screen.getByTestId('feedback-note')).toBeTruthy();
    });

    // Nhập 1001 emoji code points
    const tooLongEmojis = '🎉'.repeat(1001);
    await fireEvent.changeText(screen.getByTestId('feedback-note'), tooLongEmojis);

    await waitFor(() => {
      expect(screen.getByTestId('feedback-note-error')).toBeTruthy();
    });
    expect(screen.getByText(FEEDBACK_COPY.form.noteTooLong(1000))).toBeTruthy();
    expect(screen.getByTestId('feedback-submit').props.accessibilityState.disabled).toBe(true);

    await screen.unmount();
  });

  it('5. AC2: FEEDBACK_NOT_ALLOWED shows block with title and explanation, preserving draft', async () => {
    const { client, queryClient } = setupClient((url, init) => {
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`) && init?.method === 'POST') {
        return {
          status: 409,
          body: createProblemBody({
            code: 'FEEDBACK_NOT_ALLOWED',
            status: 409,
          }),
        };
      }
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
        return { status: 200, body: { feedback: null } };
      }
      if (url.includes('/me/match')) {
        return { status: 200, body: { match: SAMPLE_MATCH } };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit')).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId('feedback-star-4'));
    await fireEvent.press(screen.getByTestId('feedback-profileMatch-FULL_MATCH'));
    await fireEvent.press(screen.getByTestId('feedback-feeling-DEEP_INTEREST'));
    await fireEvent.press(screen.getByTestId('feedback-decision-A_COMMIT'));

    await fireEvent.press(screen.getByTestId('feedback-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit-ok')).toBeTruthy();
    });
    await fireEvent.press(screen.getByTestId('feedback-submit-ok'));

    // Xuất hiện khối feedback-not-allowed
    await waitFor(() => {
      expect(screen.getByTestId('feedback-not-allowed')).toBeTruthy();
    });
    expect(screen.getByText(messageFor({ code: 'FEEDBACK_NOT_ALLOWED' }).title)).toBeTruthy();
    expect(screen.getByText(FEEDBACK_COPY.form.notAllowedExplanation)).toBeTruthy();

    // Draft vẫn được giữ nguyên
    expect(screen.getByTestId('feedback-decision-A_COMMIT').props.accessibilityState.selected).toBe(true);

    await screen.unmount();
  });

  it('6. FEEDBACK_ALREADY_SUBMITTED transitions to review screen', async () => {
    let hasSubmitted = false;

    const { client, queryClient } = setupClient((url, init) => {
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`) && init?.method === 'POST') {
        hasSubmitted = true;
        return {
          status: 409,
          body: createProblemBody({
            code: 'FEEDBACK_ALREADY_SUBMITTED',
            status: 409,
            title: 'Bạn đã gửi đánh giá cho buổi gặp này',
          }),
        };
      }
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
        return { status: 200, body: { feedback: hasSubmitted ? SAMPLE_FEEDBACK_A : null } };
      }
      if (url.includes('/me/match')) {
        return { status: 200, body: { match: SAMPLE_MATCH } };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit')).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId('feedback-star-5'));
    await fireEvent.press(screen.getByTestId('feedback-profileMatch-FULL_MATCH'));
    await fireEvent.press(screen.getByTestId('feedback-feeling-DEEP_INTEREST'));
    await fireEvent.press(screen.getByTestId('feedback-decision-A_COMMIT'));

    await fireEvent.press(screen.getByTestId('feedback-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit-ok')).toBeTruthy();
    });
    await fireEvent.press(screen.getByTestId('feedback-submit-ok'));

    // Chuyển sang màn xem lại
    await waitFor(() => {
      expect(screen.getByTestId('feedback-review')).toBeTruthy();
    });

    await screen.unmount();
  });

  it('7. displays toast messageFor title on FEEDBACK_INVALID', async () => {
    const { client, queryClient } = setupClient((url, init) => {
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`) && init?.method === 'POST') {
        return {
          status: 422,
          body: createProblemBody({
            code: 'FEEDBACK_INVALID',
            status: 422,
            title: 'Đánh giá sau gặp không hợp lệ',
          }),
        };
      }
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
        return { status: 200, body: { feedback: null } };
      }
      if (url.includes('/me/match')) {
        return { status: 200, body: { match: SAMPLE_MATCH } };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit')).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId('feedback-star-5'));
    await fireEvent.press(screen.getByTestId('feedback-profileMatch-FULL_MATCH'));
    await fireEvent.press(screen.getByTestId('feedback-feeling-DEEP_INTEREST'));
    await fireEvent.press(screen.getByTestId('feedback-decision-A_COMMIT'));

    await fireEvent.press(screen.getByTestId('feedback-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit-ok')).toBeTruthy();
    });
    await fireEvent.press(screen.getByTestId('feedback-submit-ok'));

    const expectedTitle = messageFor({ code: 'FEEDBACK_INVALID' }).title;
    await waitFor(() => {
      expect(screen.getByText(expectedTitle)).toBeTruthy();
    });

    await screen.unmount();
  });

  describe('8. Kết quả 3 nhánh', () => {
    it('Branch 1: A_COMMIT + match still open → renders feedback-result-waiting', async () => {
      const { client, queryClient } = setupClient((url) => {
        if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
          return { status: 200, body: { feedback: SAMPLE_FEEDBACK_A } };
        }
        if (url.includes('/me/match')) {
          return { status: 200, body: { match: SAMPLE_MATCH } };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByTestId('feedback-result-waiting')).toBeTruthy();
      });
      expect(screen.getByText(FEEDBACK_COPY.result.waiting.title)).toBeTruthy();
      expect(screen.getByText(FEEDBACK_COPY.result.waiting.description)).toBeTruthy();

      await screen.unmount();
    });

    it('Branch 2: A_COMMIT + match is null (closed) → renders neutral feedback-result-closed', async () => {
      const { client, queryClient } = setupClient((url) => {
        if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
          return { status: 200, body: { feedback: SAMPLE_FEEDBACK_A } };
        }
        if (url.includes('/me/match')) {
          return { status: 200, body: { match: null } };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByTestId('feedback-result-closed')).toBeTruthy();
      });
      expect(screen.getByText(FEEDBACK_COPY.result.closed.title)).toBeTruthy();
      expect(screen.getByText(FEEDBACK_COPY.result.closed.description)).toBeTruthy();

      await screen.unmount();
    });

    it('A_COMMIT mà GET /me/match lỗi → không kết luận đã khép lại; thử lại được', async () => {
      let failing = true;
      const { client, queryClient } = setupClient((url) => {
        if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
          return { status: 200, body: { feedback: SAMPLE_FEEDBACK_A } };
        }
        if (url.includes('/me/match')) {
          return failing
            ? { status: 500, body: createProblemBody({ code: 'INTERNAL_ERROR', status: 500 }) }
            : { status: 200, body: { match: null } };
        }
        return { status: 404 };
      });
      const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
        client,
        queryClient,
      });
      await waitFor(() => {
        expect(screen.getByLabelText('Thử lại')).toBeTruthy();
      });
      expect(screen.queryByTestId('feedback-result-closed')).toBeNull();

      failing = false;
      await fireEvent.press(screen.getByLabelText('Thử lại'));
      await waitFor(() => {
        expect(screen.getByTestId('feedback-result-closed')).toBeTruthy();
      });
      await screen.unmount();
    });

    it('Branch 3: B_STOP → renders feedback-result-stopped with COOLDOWN_DAYS', async () => {
      const { client, queryClient } = setupClient((url) => {
        if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
          return { status: 200, body: { feedback: SAMPLE_FEEDBACK_B } };
        }
        if (url.includes('/me/match')) {
          return { status: 200, body: { match: null } };
        }
        return { status: 404 };
      });

      const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
        client,
        queryClient,
      });

      await waitFor(() => {
        expect(screen.getByTestId('feedback-result-stopped')).toBeTruthy();
      });
      expect(screen.getByText(FEEDBACK_COPY.result.stopped.title)).toBeTruthy();
      expect(screen.getByText(FEEDBACK_COPY.result.stopped.description(COOLDOWN_DAYS))).toBeTruthy();

      await screen.unmount();
    });
  });

  it('9. review screen renders read-only submitted feedback', async () => {
    const { client, queryClient } = setupClient((url) => {
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
        return { status: 200, body: { feedback: SAMPLE_FEEDBACK_B } };
      }
      if (url.includes('/me/match')) {
        return { status: 200, body: { match: null } };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-review')).toBeTruthy();
    });

    expect(screen.getByText(FEEDBACK_PROFILE_MATCH_COPY.DIFFERENT)).toBeTruthy();
    expect(screen.getByText(FEEDBACK_FEELING_COPY.NOT_A_FIT)).toBeTruthy();
    expect(screen.getByText(FEEDBACK_DECISION_COPY.B_STOP)).toBeTruthy();
    expect(screen.getByText(`• ${FEEDBACK_STOP_REASON_COPY.NO_SPARK}`)).toBeTruthy();
    expect(screen.getByText(`• ${FEEDBACK_STOP_REASON_COPY.LIFESTYLE_DIFFERENCE}`)).toBeTruthy();
    expect(screen.getByText('Cần thêm thời gian cân bằng')).toBeTruthy();

    // Không render form submit
    expect(screen.queryByTestId('feedback-submit')).toBeNull();

    await screen.unmount();
  });

  it('10. contains no forbidden terms in copy or rendered screen', async () => {
    const forbiddenRegex = /tốt nghiệp|chúc mừng|AI|%|eKYC|Mai Hương/i;

    function checkStrings(obj: unknown): void {
      if (typeof obj === 'string') {
        expect(obj).not.toMatch(forbiddenRegex);
      } else if (typeof obj === 'object' && obj !== null) {
        for (const val of Object.values(obj)) {
          checkStrings(val);
        }
      }
    }

    checkStrings(FEEDBACK_COPY);
    checkStrings(FEEDBACK_PROFILE_MATCH_COPY);
    checkStrings(FEEDBACK_FEELING_COPY);
    checkStrings(FEEDBACK_DECISION_COPY);
    checkStrings(FEEDBACK_STOP_REASON_COPY);

    const { client, queryClient } = setupClient((url) => {
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
        return { status: 200, body: { feedback: null } };
      }
      if (url.includes('/me/match')) {
        return { status: 200, body: { match: SAMPLE_MATCH } };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-submit')).toBeTruthy();
    });

    expect(screen.queryByText(forbiddenRegex)).toBeNull();
    await screen.unmount();
  });

  it('11. only calls own endpoints and does not display peer evaluation or name in review', async () => {
    const calledUrls: string[] = [];

    const { client, queryClient } = setupClient((url) => {
      calledUrls.push(url);
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
        return { status: 200, body: { feedback: SAMPLE_FEEDBACK_A } };
      }
      if (url.includes('/me/match')) {
        return { status: 200, body: { match: SAMPLE_MATCH } };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByTestId('feedback-review')).toBeTruthy();
    });

    // Chỉ gọi URL của mình
    for (const url of calledUrls) {
      expect(url.startsWith('http://api.test/me/')).toBe(true);
    }

    // Không hiển thị tên hay dữ liệu đối phương trong form/review
    expect(screen.queryByText('Minh Trang')).toBeNull();

    await screen.unmount();
  });

  it('12. handles header back navigation', async () => {
    const { client, queryClient } = setupClient((url) => {
      if (url.includes(`/me/dates/${DATE_PLAN_ID}/feedback`)) {
        return { status: 200, body: { feedback: null } };
      }
      if (url.includes('/me/match')) {
        return { status: 200, body: { match: SAMPLE_MATCH } };
      }
      return { status: 404 };
    });

    const screen = await renderWithProviders(<FeedbackScreen datePlanId={DATE_PLAN_ID} />, {
      client,
      queryClient,
    });

    await waitFor(() => {
      expect(screen.getByLabelText(FEEDBACK_COPY.header.back)).toBeTruthy();
    });

    await fireEvent.press(screen.getByLabelText(FEEDBACK_COPY.header.back));
    expect(mockBack).toHaveBeenCalled();

    await screen.unmount();
  });
});
