import { createApiClient, createMemoryTokenStore } from '@tamgiao/api-client';
import type { CurrentMatchDto, MatchProfileResponse } from '@tamgiao/contracts/matching';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../../test-utils/render-with-providers.js';
import { PROFILE_COPY } from '../../profile/copy.js';
import { MATCH_PROFILE_COPY } from './copy.js';
import { MatchProfileScreen } from './match-profile-screen.js';

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

function buildCurrentMatch(overrides: Partial<CurrentMatchDto> = {}): CurrentMatchDto {
  return {
    matchId: '01890a5d-ac96-774b-bcce-b302099a8050',
    status: 'OFFERED',
    phase: 'NEEDS_MY_RESPONSE',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    offeredAt: '2026-11-24T08:00:00.000Z',
    datingStartedAt: null,
    score: null,
    commonPoints: [],
    staffNote: null,
    counterpart: null,
    ...overrides,
  };
}

function buildMatchProfile(overrides: Partial<MatchProfileResponse> = {}): MatchProfileResponse {
  return {
    matchId: '01890a5d-ac96-774b-bcce-b302099a8050',
    status: 'OFFERED',
    phase: 'NEEDS_MY_RESPONSE',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    score: null,
    commonPoints: [],
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
        {
          url: 'https://example.com/photo2.jpg',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        },
        {
          url: 'https://example.com/photo3.jpg',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
    },
    ...overrides,
  };
}

describe('MatchProfileScreen (FE-S4-03)', () => {
  let matchBody: unknown = null;
  let matchStatus = 200;
  let profileBody: unknown = null;
  let profileStatus = 200;
  let profileCallCount = 0;
  const calledUrls: string[] = [];

  const fakeFetch = createFakeFetch((url) => {
    calledUrls.push(url);
    if (url === 'http://api.test/me/match') {
      return { status: matchStatus, body: matchBody };
    }
    if (url.startsWith('http://api.test/me/match/profile')) {
      profileCallCount++;
      return { status: profileStatus, body: profileBody };
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
    return renderWithProviders(<MatchProfileScreen />, { client, queryClient });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    calledUrls.length = 0;
    profileCallCount = 0;
    matchStatus = 200;
    profileStatus = 200;
    mockCanGoBack.mockReturnValue(true);

    matchBody = { match: buildCurrentMatch() };
    profileBody = buildMatchProfile();
  });

  it('a. hồ sơ đủ trường → hiện đúng từng trường, số ảnh, khối riêng tư "Chưa mở"', async () => {
    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(MATCH_PROFILE_COPY.nameAge('Minh Trang', 28))).toBeTruthy();
      expect(screen.getByText(MATCH_PROFILE_COPY.gender.female)).toBeTruthy();
      expect(screen.getByText('TP. Hồ Chí Minh')).toBeTruthy();
      expect(screen.getByText('Trưởng nhóm Kiểm toán')).toBeTruthy();
      expect(screen.getByText(PROFILE_COPY.educationOptions.bachelor)).toBeTruthy();
      expect(screen.getByText(MATCH_PROFILE_COPY.quoteBio('Yêu thích đọc sách và cắm trại'))).toBeTruthy();
      expect(screen.getByText('Cà phê sách')).toBeTruthy();
      expect(screen.getByText('Nấu ăn')).toBeTruthy();
      expect(screen.getByText(MATCH_PROFILE_COPY.photoCounter(1, 3))).toBeTruthy();
      expect(screen.getByTestId('profile-private-locked')).toBeTruthy();
      expect(screen.getByText(MATCH_PROFILE_COPY.private.title)).toBeTruthy();
      expect(screen.getByText(MATCH_PROFILE_COPY.private.badge)).toBeTruthy();
      expect(screen.getByText(MATCH_PROFILE_COPY.private.body)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('b. hồ sơ thiếu (bio null, interests [], photos []) → emptyBio, emptyInterests, profile-no-photo', async () => {
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
      expect(screen.getByText(MATCH_PROFILE_COPY.emptyBio)).toBeTruthy();
      expect(screen.getByText(MATCH_PROFILE_COPY.emptyInterests)).toBeTruthy();
      expect(screen.getByTestId('profile-no-photo')).toBeTruthy();
      expect(screen.getByText(MATCH_PROFILE_COPY.noPhoto)).toBeTruthy();
    });

    await screen.unmount();
  });

  it('c. AC1: JSON fixture không chứa trường riêng tư → màn không có text /thu nhập|triệu|bất động sản|CIC|kết hôn|VNeID|CCCD|tương hợp|%/i; chỉ gọi đúng hai URL /me/match và /me/match/profile?matchId=…', async () => {
    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(MATCH_PROFILE_COPY.nameAge('Minh Trang', 28))).toBeTruthy();
    });

    expect(screen.queryByText(/thu nhập|triệu|bất động sản|CIC|kết hôn|VNeID|CCCD|tương hợp|%/i)).toBeNull();

    expect(calledUrls).toEqual([
      'http://api.test/me/match',
      'http://api.test/me/match/profile?matchId=01890a5d-ac96-774b-bcce-b302099a8050',
    ]);

    await screen.unmount();
  });

  it('d. match null → noMatch, không gọi profile; bấm cta → replace /(main)/home', async () => {
    matchBody = { match: null };

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(MATCH_PROFILE_COPY.noMatch.title)).toBeTruthy();
      expect(screen.getByText(MATCH_PROFILE_COPY.noMatch.description)).toBeTruthy();
    });

    expect(calledUrls).toEqual(['http://api.test/me/match']);
    expect(profileCallCount).toBe(0);

    const cta = screen.getByText(MATCH_PROFILE_COPY.noMatch.cta);
    await act(async () => {
      await fireEvent.press(cta);
    });

    expect(mockReplace).toHaveBeenCalledWith('/(main)/home');

    await screen.unmount();
  });

  it('e. profile lỗi 500 → ErrorState → retry thành công', async () => {
    profileStatus = 500;
    profileBody = createProblemBody({
      code: 'INTERNAL_ERROR',
      status: 500,
      title: 'Lỗi máy chủ nội bộ',
    });

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByLabelText('Thử lại')).toBeTruthy();
    });

    profileStatus = 200;
    profileBody = buildMatchProfile();

    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Thử lại'));
    });

    await waitFor(() => {
      expect(screen.getByText(MATCH_PROFILE_COPY.nameAge('Minh Trang', 28))).toBeTruthy();
    });

    await screen.unmount();
  });

  it('f. ảnh lỗi (fireEvent(image, error)) → gọi lại profile đúng 1 lần dù lỗi 2 lần cùng url', async () => {
    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByTestId('profile-photo-0')).toBeTruthy();
    });

    const initialCalls = profileCallCount;
    const photo = screen.getByTestId('profile-photo-0');

    await act(async () => {
      await fireEvent(photo, 'error');
    });

    await waitFor(() => {
      expect(profileCallCount).toBe(initialCalls + 1);
    });

    await act(async () => {
      await fireEvent(photo, 'error');
    });

    expect(profileCallCount).toBe(initialCalls + 1);

    await screen.unmount();
  });

  it('g. vuốt gallery (fireEvent(gallery, momentumScrollEnd, {nativeEvent:{contentOffset:{x:375},layoutMeasurement:{width:375}}})) → counter "2/3"', async () => {
    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(MATCH_PROFILE_COPY.photoCounter(1, 3))).toBeTruthy();
    });

    const gallery = screen.getByTestId('profile-gallery');

    await act(async () => {
      await fireEvent(gallery, 'momentumScrollEnd', {
        nativeEvent: {
          contentOffset: { x: 375 },
          layoutMeasurement: { width: 375 },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(MATCH_PROFILE_COPY.photoCounter(2, 3))).toBeTruthy();
    });

    await screen.unmount();
  });

  it('h. nút back: canGoBack true → back; false → replace home', async () => {
    mockCanGoBack.mockReturnValue(true);

    const screen = await setupScreen();

    await waitFor(() => {
      expect(screen.getByText(MATCH_PROFILE_COPY.nameAge('Minh Trang', 28))).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByLabelText(MATCH_PROFILE_COPY.header.back));
    });

    expect(mockBack).toHaveBeenCalled();

    mockCanGoBack.mockReturnValue(false);

    await act(async () => {
      await fireEvent.press(screen.getByLabelText(MATCH_PROFILE_COPY.header.back));
    });

    expect(mockReplace).toHaveBeenCalledWith('/(main)/home');

    await screen.unmount();
  });
});
