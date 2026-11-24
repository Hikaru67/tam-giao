import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import type { CurrentMatchDto, MatchProfileResponse } from '@tamgiao/contracts/matching';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { PROFILE_COPY } from '../profile/copy.js';
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

function buildCurrentMatch(overrides: Partial<CurrentMatchDto> = {}): CurrentMatchDto {
  return {
    matchId: '01890a5d-ac96-774b-bcce-b302099a8050',
    status: 'OFFERED',
    phase: 'NEEDS_MY_RESPONSE',
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

function buildMatchProfile(overrides: Partial<MatchProfileResponse> = {}): MatchProfileResponse {
  return {
    matchId: '01890a5d-ac96-774b-bcce-b302099a8050',
    status: 'OFFERED',
    phase: 'NEEDS_MY_RESPONSE',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    score: {
      total: 94,
      pillars: {
        VALUES_FAMILY: 96,
        PLANS_TIMING: 95,
        LIFESTYLE_FINANCE: 91,
      },
    },
    commonPoints: ['SAME_CITY'],
    counterpart: {
      userId: '01890a5d-ac96-774b-bcce-b302099a8051',
      displayName: 'Minh Trang',
      age: 28,
      gender: 'female',
      currentCity: 'TP. Hồ Chí Minh',
      occupation: 'Trưởng nhóm Kiểm toán',
      education: 'bachelor',
      bio: 'Yêu thích đọc sách và cắm trại',
      interests: ['Cà phê sách', 'Nấu ăn'],
      photos: [
        {
          url: 'https://example.com/photo1.jpg',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
    },
    ...overrides,
  };
}

describe('MatchHomeScreen (FE-S4-01)', () => {
  let matchBody: unknown = null;
  let matchStatus = 200;
  let profileBody: unknown = null;
  let profileStatus = 200;
  let acceptBody: unknown = null;
  let acceptStatus = 200;
  let declineBody: unknown = null;
  let declineStatus = 200;

  let getMatchCount = 0;
  let acceptCount = 0;
  let declineCount = 0;
  let lastDeclineBody: unknown = null;
  let returnNullOnNextMatchGet = false;

  const fakeFetch = createFakeFetch((url, init) => {
    if (url === 'http://api.test/me/match') {
      getMatchCount++;
      const body = matchBody;
      if (getMatchCount >= 1 && returnNullOnNextMatchGet) {
        matchBody = { match: null };
      }
      return { status: matchStatus, body };
    }
    if (url.startsWith('http://api.test/me/match/profile')) {
      return { status: profileStatus, body: profileBody };
    }
    if (url === 'http://api.test/me/match/accept') {
      acceptCount++;
      if (acceptStatus !== 200) {
        return { status: acceptStatus, body: acceptBody };
      }
      return {
        status: 200,
        body: {
          matchId: '01890a5d-ac96-774b-bcce-b302099a8050',
          status: 'AWAITING_RESPONSE',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        },
      };
    }
    if (url === 'http://api.test/me/match/decline') {
      declineCount++;
      lastDeclineBody = init?.body ? JSON.parse(init.body as string) : null;
      if (declineStatus !== 200) {
        return { status: declineStatus, body: declineBody };
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
    acceptCount = 0;
    declineCount = 0;
    lastDeclineBody = null;
    returnNullOnNextMatchGet = false;

    matchStatus = 200;
    profileStatus = 200;
    acceptStatus = 200;
    declineStatus = 200;

    matchBody = { match: buildCurrentMatch() };
    profileBody = buildMatchProfile();
    acceptBody = null;
    declineBody = null;
  });

  it('a. OFFERED (NEEDS_MY_RESPONSE): hiện displayName+age, nghề, học vấn, bio, sở thích; KHÔNG có text số điểm/%, staffNote, commonPoints; không có từ cấm', async () => {
    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText('Minh Trang, 28')).toBeTruthy();
      expect(screen.getByText('TP. Hồ Chí Minh')).toBeTruthy();
      expect(screen.getByText('Trưởng nhóm Kiểm toán')).toBeTruthy();
      expect(screen.getByText(PROFILE_COPY.educationOptions.bachelor)).toBeTruthy();
      expect(screen.getByText('"Yêu thích đọc sách và cắm trại"')).toBeTruthy();
      expect(screen.getByText('Cà phê sách')).toBeTruthy();
      expect(screen.getByText('Nấu ăn')).toBeTruthy();
    });

    // KHÔNG hiển thị số điểm/%, staffNote, commonPoints
    expect(screen.queryByText(/94%|96%|95%|91%/)).toBeNull();
    expect(screen.queryByText('Ghi chú bí mật')).toBeNull();
    expect(screen.queryByText('SAME_CITY')).toBeNull();

    // KHÔNG chứa từ ngữ nhạy cảm cấm theo FE-D5/FE-D6
    expect(screen.queryByText(/ký quỹ|bảo chứng|VNeID|liveness|tương hợp/i)).toBeNull();

    await screen.unmount();
  });

  it('b. AC1: expiresAt đã qua → match-expired hiện, match-accept disabled, số lần GET /me/match ≥ 2; bấm không gửi POST', async () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString();
    matchBody = { match: buildCurrentMatch({ expiresAt }) };
    profileBody = buildMatchProfile({ expiresAt });

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-expired')).toBeTruthy();
      expect(screen.getByTestId('match-accept').props.accessibilityState.disabled).toBe(true);
      expect(getMatchCount).toBeGreaterThanOrEqual(2);
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-accept'));
    });

    expect(acceptCount).toBe(0);

    await screen.unmount();
  });

  it('c. AC1b: sau khi hết hạn, server trả { match: null } ở lần gọi 2 → hiện match-searching', async () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString();
    matchBody = { match: buildCurrentMatch({ expiresAt }) };
    profileBody = buildMatchProfile({ expiresAt });
    returnNullOnNextMatchGet = true;

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-searching')).toBeTruthy();
      expect(screen.getByText(MATCH_COPY.searching.title)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('d. accept: bấm match-accept → match-accept-confirm → POST /me/match/accept 1 lần, GET lại, server đổi sang WAITING_FOR_COUNTERPART → hiện match-phase-WAITING_FOR_COUNTERPART', async () => {
    const screen = await setupScreen();

    // Nút đồng ý chỉ bật khi hồ sơ đã tải xong.
    await waitFor(() => {
      expect(screen.getByTestId('match-accept').props.accessibilityState.disabled).toBe(false);
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-accept'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('match-accept-confirm')).toBeTruthy();
    });

    matchBody = {
      match: buildCurrentMatch({
        phase: 'WAITING_FOR_COUNTERPART',
        status: 'AWAITING_RESPONSE',
      }),
    };

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-accept-confirm'));
    });

    await waitFor(() => {
      expect(acceptCount).toBe(1);
      expect(screen.getByTestId('match-phase-WAITING_FOR_COUNTERPART')).toBeTruthy();
      expect(screen.getByText(MATCH_COPY.toast.accepted)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('e. decline kèm lý do: body gửi { reason: <label> }; decline không lý do: không có body', async () => {
    // Phần 1: Decline kèm lý do
    const screen1 = await setupScreen();

    await waitFor(() => {
      expect(screen1.getByTestId('match-decline')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen1.getByTestId('match-decline'));
    });

    await waitFor(() => {
      expect(screen1.getByTestId('match-decline-confirm')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen1.getByTestId('match-decline-reason-distance'));
    });

    await act(async () => {
      await fireEvent.press(screen1.getByTestId('match-decline-confirm'));
    });

    await waitFor(() => {
      expect(declineCount).toBe(1);
      expect(lastDeclineBody).toEqual({ reason: MATCH_COPY.declineReasons[0].label });
      expect(screen1.getByText(MATCH_COPY.toast.declined)).toBeTruthy();
    });

    await screen1.unmount();

    // Phần 2: Decline không lý do (chọn rồi bấm lại để bỏ chọn)
    declineCount = 0;
    lastDeclineBody = 'NOT_SET';
    const screen2 = await setupScreen();

    await waitFor(() => {
      expect(screen2.getByTestId('match-decline')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen2.getByTestId('match-decline'));
    });

    await waitFor(() => {
      expect(screen2.getByTestId('match-decline-confirm')).toBeTruthy();
    });

    // Chọn rồi bấm lại để bỏ chọn
    await act(async () => {
      await fireEvent.press(screen2.getByTestId('match-decline-reason-distance'));
    });
    await act(async () => {
      await fireEvent.press(screen2.getByTestId('match-decline-reason-distance'));
    });

    await act(async () => {
      await fireEvent.press(screen2.getByTestId('match-decline-confirm'));
    });

    await waitFor(() => {
      expect(declineCount).toBe(1);
      expect(lastDeclineBody).toBeNull();
      expect(screen2.getByText(MATCH_COPY.toast.declined)).toBeTruthy();
    });

    await screen2.unmount();
  });

  it('f. accept lỗi 410 OFFER_EXPIRED → toast messageFor({code: "OFFER_EXPIRED"}).title, GET lại', async () => {
    acceptStatus = 410;
    acceptBody = createProblemBody({
      code: 'OFFER_EXPIRED',
      status: 410,
      title: 'Gợi ý ghép đôi đã hết hạn',
    });

    const screen = await setupScreen();

    // Nút đồng ý chỉ bật khi hồ sơ đã tải xong.
    await waitFor(() => {
      expect(screen.getByTestId('match-accept').props.accessibilityState.disabled).toBe(false);
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-accept'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('match-accept-confirm')).toBeTruthy();
    });

    const getCountBefore = getMatchCount;

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-accept-confirm'));
    });

    await waitFor(() => {
      expect(screen.getByText(messageFor({ code: 'OFFER_EXPIRED' }).title)).toBeTruthy();
      expect(getMatchCount).toBeGreaterThan(getCountBefore);
    });

    await screen.unmount();
  });

  it('g. decline lỗi 404 NO_OPEN_MATCH → toast, GET lại trả null → match-searching', async () => {
    declineStatus = 404;
    declineBody = createProblemBody({
      code: 'NO_OPEN_MATCH',
      status: 404,
      title: 'Không có ghép đôi đang mở',
    });

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-decline')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-decline'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('match-decline-confirm')).toBeTruthy();
    });

    // Khi decline thất bại, lần GET tiếp theo server trả về match null
    matchBody = { match: null };

    await act(async () => {
      await fireEvent.press(screen.getByTestId('match-decline-confirm'));
    });

    await waitFor(() => {
      expect(screen.getByText(messageFor({ code: 'NO_OPEN_MATCH' }).title)).toBeTruthy();
      expect(screen.getByTestId('match-searching')).toBeTruthy();
    });

    await screen.unmount();
  });

  it('h. COUNTERPART_ACCEPTED hiện copy counterpartAccepted', async () => {
    matchBody = {
      match: buildCurrentMatch({
        phase: 'COUNTERPART_ACCEPTED',
        status: 'AWAITING_RESPONSE',
      }),
    };
    profileBody = buildMatchProfile({
      phase: 'COUNTERPART_ACCEPTED',
      status: 'AWAITING_RESPONSE',
    });

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(MATCH_COPY.offer.counterpartAccepted)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('i. push MATCH_OFFERED khi đang ở trạng thái searching → GET lại và hiện gợi ý; push KYC_APPROVED không gọi lại', async () => {
    matchBody = { match: null };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('match-searching')).toBeTruthy();
    });

    matchBody = { match: buildCurrentMatch() };
    profileBody = buildMatchProfile();

    // Push thông báo MATCH_OFFERED
    await act(async () => {
      mockReceivedListeners.forEach((l) =>
        l({
          request: {
            content: {
              data: {
                kind: 'MATCH_OFFERED',
                deliveryId: '01890a5d-ac96-774b-bcce-b302099a8052',
              },
            },
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('match-accept')).toBeTruthy();
    });

    // Push thông báo KYC_APPROVED không nằm trong MATCH_PUSH_KINDS → không gọi lại GET /me/match
    const countBefore = getMatchCount;
    await act(async () => {
      mockReceivedListeners.forEach((l) =>
        l({
          request: {
            content: {
              data: {
                kind: 'KYC_APPROVED',
                deliveryId: '01890a5d-ac96-774b-bcce-b302099a8053',
              },
            },
          },
        }),
      );
    });

    expect(getMatchCount).toBe(countBefore);

    await screen.unmount();
  });

  it('j. GET /me/match 500 → ErrorState, bấm thử lại → thành công', async () => {
    matchStatus = 500;
    matchBody = createProblemBody({
      code: 'INTERNAL_ERROR',
      status: 500,
      title: 'Lỗi máy chủ nội bộ',
    });

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByLabelText('Thử lại')).toBeTruthy();
    });

    matchStatus = 200;
    matchBody = { match: buildCurrentMatch() };
    profileBody = buildMatchProfile();

    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Thử lại'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('match-accept')).toBeTruthy();
    });

    await screen.unmount();
  });

  it('k. bio null + interests rỗng → không có tiêu đề hai khối đó; ảnh rỗng → noPhoto', async () => {
    matchBody = { match: buildCurrentMatch() };
    profileBody = buildMatchProfile({
      counterpart: {
        ...buildMatchProfile().counterpart,
        bio: null,
        interests: [],
        photos: [],
      },
    });

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(MATCH_COPY.offer.noPhoto)).toBeTruthy();
    });

    expect(screen.queryByText(MATCH_COPY.offer.bioTitle)).toBeNull();
    expect(screen.queryByText(MATCH_COPY.offer.interestsTitle)).toBeNull();
    await screen.unmount();
  });
});
