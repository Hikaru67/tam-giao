import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import { DATING_DAYS, RESPONSE_TTL_HOURS } from '@tamgiao/contracts/constants';
import type { CurrentMatchDto } from '@tamgiao/contracts/matching';
import type { ConversationSummaryDto } from '@tamgiao/contracts/messaging';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { MATCH_COPY } from './copy.js';
import { MatchHomeScreen } from './match-home-screen.js';

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

const mockReceivedListeners: Array<(n: unknown) => void> = [];
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: (cb: (n: unknown) => void) => {
    mockReceivedListeners.push(cb);
    return {
      remove: () => {
        const i = mockReceivedListeners.indexOf(cb);
        if (i >= 0) mockReceivedListeners.splice(i, 1);
      },
    };
  },
}));

function triggerPush(kind: string) {
  for (const cb of mockReceivedListeners) {
    cb({ request: { content: { data: { kind } } } });
  }
}

function buildWaitingMatch(overrides: Partial<CurrentMatchDto> = {}): CurrentMatchDto {
  return {
    matchId: '01890a5d-ac96-774b-bcce-b302099a8050',
    status: 'AWAITING_RESPONSE',
    phase: 'WAITING_FOR_COUNTERPART',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    offeredAt: '2026-11-24T08:00:00.000Z',
    datingStartedAt: null,
    score: {
      total: 94,
      pillars: {
        VALUES_FAMILY: 96,
        PLANS_TIMING: 95,
        LIFESTYLE_FINANCE: 91,
      },
    },
    commonPoints: ['SAME_CITY'],
    staffNote: 'Ghi chú bí mật',
    counterpart: {
      userId: '01890a5d-ac96-774b-bcce-b302099a8051',
      displayName: 'Minh Trang',
      age: 28,
      currentCity: 'TP. Hồ Chí Minh',
      occupation: 'Trưởng nhóm Kiểm toán',
      education: 'bachelor',
      avatar: {
        url: 'https://example.com/avatar.jpg',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    },
    ...overrides,
  };
}

function buildConversationItem(overrides: Partial<ConversationSummaryDto> = {}): ConversationSummaryDto {
  return {
    conversationId: '01890a5d-ac96-774b-bcce-b302099a8052',
    peerUserId: '01890a5d-ac96-774b-bcce-b302099a8051',
    status: 'OPEN',
    openedAt: '2026-11-24T09:00:00.000Z',
    closesAt: '2026-12-08T09:00:00.000Z',
    datingDay: 1,
    datingDays: DATING_DAYS,
    lastMessage: null,
    unreadCount: 0,
    lastReadMessageId: null,
    ...overrides,
  };
}

describe('MatchWaitingCard & MatchDatingCard (FE-S4-02)', () => {
  let matchBody: unknown = null;
  let matchStatus = 200;
  let conversationsBody: unknown = null;
  let conversationsStatus = 200;
  let withdrawBody: unknown = null;
  let withdrawStatus = 200;

  let getMatchCount = 0;
  let withdrawCount = 0;

  const fakeFetch = createFakeFetch((url) => {
    if (url === 'http://api.test/me/match') {
      getMatchCount++;
      return { status: matchStatus, body: matchBody };
    }
    if (url.startsWith('http://api.test/me/conversations')) {
      return { status: conversationsStatus, body: conversationsBody };
    }
    if (url === 'http://api.test/me/match/withdraw') {
      withdrawCount++;
      if (withdrawStatus !== 200) {
        return { status: withdrawStatus, body: withdrawBody };
      }
      return {
        status: 200,
        body: {
          matchId: '01890a5d-ac96-774b-bcce-b302099a8050',
          status: 'DECLINED',
          expiresAt: null,
        },
      };
    }
    return { status: 404 };
  });

  const setupScreen = async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();
    return renderWithProviders(<MatchHomeScreen />, { client, queryClient });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockReceivedListeners.length = 0;
    getMatchCount = 0;
    withdrawCount = 0;

    matchStatus = 200;
    conversationsStatus = 200;
    withdrawStatus = 200;

    matchBody = { match: buildWaitingMatch() };
    conversationsBody = { items: [] };
    withdrawBody = null;
  });

  it('a. render waiting: tên, tuổi, nghề, thành phố; không có /%|tương hợp|VNeID|chuyên viên|lời ngỏ chân thành của bạn/i ; có RESPONSE_TTL_HOURS', async () => {
    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-waiting')).toBeTruthy();
      expect(screen.getByText('Minh Trang, 28')).toBeTruthy();
      expect(screen.getByText('Trưởng nhóm Kiểm toán')).toBeTruthy();
      expect(screen.getByText('TP. Hồ Chí Minh')).toBeTruthy();
      expect(screen.getByText(MATCH_COPY.waiting.maxResponseHours(RESPONSE_TTL_HOURS))).toBeTruthy();
    });

    expect(screen.queryByText(/%|tương hợp|VNeID|chuyên viên|lời ngỏ chân thành của bạn/i)).toBeNull();

    await screen.unmount();
  });

  it('b. withdraw: xác nhận → POST 1 lần → GET trả null → match-searching; toast', async () => {
    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-withdraw').props.accessibilityState.disabled).toBe(false);
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-withdraw'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('match-withdraw-confirm')).toBeTruthy();
    });

    matchBody = { match: null };

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-withdraw-confirm'));
    });

    await waitFor(() => {
      expect(withdrawCount).toBe(1);
      expect(screen.getByTestId('match-searching')).toBeTruthy();
      expect(screen.getByText(MATCH_COPY.toast.withdrawn)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('c. withdraw lỗi 409 INVALID_TRANSITION, GET lại trả DATING → toast lỗi + tự chuyển /(main)/chat/<id>', async () => {
    withdrawStatus = 409;
    withdrawBody = createProblemBody({
      code: 'INVALID_TRANSITION',
      status: 409,
      title: 'Trạng thái không hợp lệ',
    });

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-withdraw').props.accessibilityState.disabled).toBe(false);
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-withdraw'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('match-withdraw-confirm')).toBeTruthy();
    });

    matchBody = {
      match: buildWaitingMatch({
        phase: 'DATING',
        status: 'DATING',
      }),
    };
    conversationsBody = { items: [buildConversationItem()] };

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-withdraw-confirm'));
    });

    await waitFor(() => {
      expect(screen.getByText(messageFor({ code: 'INVALID_TRANSITION' }).title)).toBeTruthy();
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/(main)/chat/01890a5d-ac96-774b-bcce-b302099a8052');
    });

    await screen.unmount();
  });

  it('d. AC1: đang mở WAITING, server đổi sang DATING, push MATCH_STARTED_DATING → GET lại, GET /me/conversations trả hội thoại khớp peer → mockPush gọi đúng 1 lần với /(main)/chat/<conversationId>', async () => {
    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-waiting')).toBeTruthy();
    });

    matchBody = {
      match: buildWaitingMatch({
        phase: 'DATING',
        status: 'DATING',
      }),
    };
    conversationsBody = { items: [buildConversationItem()] };

    await act(async () => {
      triggerPush('MATCH_STARTED_DATING');
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/(main)/chat/01890a5d-ac96-774b-bcce-b302099a8052');
    });

    await screen.unmount();
  });

  it('e. AC1 trễ: conversations lần đầu trả rỗng, lần 2 có → vẫn chuyển', async () => {
    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-waiting')).toBeTruthy();
    });

    matchBody = {
      match: buildWaitingMatch({
        phase: 'DATING',
        status: 'DATING',
      }),
    };
    conversationsBody = { items: [] };

    await act(async () => {
      triggerPush('MATCH_STARTED_DATING');
    });

    await waitFor(() => {
      expect(screen.getByTestId('match-phase-DATING')).toBeTruthy();
    });

    conversationsBody = { items: [buildConversationItem()] };

    await waitFor(
      () => {
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush).toHaveBeenCalledWith('/(main)/chat/01890a5d-ac96-774b-bcce-b302099a8052');
      },
      { timeout: 6000 },
    );

    await screen.unmount();
  }, 15000);

  it('f. mở màn khi đã DATING → KHÔNG tự chuyển; bấm match-open-chat → push', async () => {
    matchBody = {
      match: buildWaitingMatch({
        phase: 'DATING',
        status: 'DATING',
      }),
    };
    conversationsBody = { items: [buildConversationItem()] };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-phase-DATING')).toBeTruthy();
      expect(screen.getByTestId('match-open-chat').props.accessibilityState.disabled).toBe(false);
    });

    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-open-chat'));
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/(main)/chat/01890a5d-ac96-774b-bcce-b302099a8052');

    await screen.unmount();
  });

  it('g. hội thoại CLOSED hoặc peer khác → nút disabled', async () => {
    matchBody = {
      match: buildWaitingMatch({
        phase: 'DATING',
        status: 'DATING',
      }),
    };
    conversationsBody = {
      items: [
        buildConversationItem({ status: 'CLOSED' }),
        buildConversationItem({ peerUserId: '01890a5d-ac96-774b-bcce-b302099a8053' }),
      ],
    };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-open-chat').props.accessibilityState.disabled).toBe(true);
      expect(screen.getByText(MATCH_COPY.dating.openingChat)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('h. expiresAt đã qua → match-waiting-expired, không có match-withdraw, GET ≥ 2', async () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString();
    matchBody = { match: buildWaitingMatch({ expiresAt }) };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-waiting-expired')).toBeTruthy();
      expect(screen.queryByTestId('match-withdraw')).toBeNull();
      expect(getMatchCount).toBeGreaterThanOrEqual(2);
    });

    await screen.unmount();
  });

  it('i. counterpart null → vẫn render, không crash', async () => {
    matchBody = { match: buildWaitingMatch({ counterpart: null }) };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-waiting')).toBeTruthy();
      expect(screen.getAllByText(MATCH_COPY.waiting.titleWithoutName).length).toBeGreaterThan(0);
      expect(screen.getByTestId('match-view-profile').props.accessibilityState.disabled).toBe(true);
    });

    await screen.unmount();
  });
});
