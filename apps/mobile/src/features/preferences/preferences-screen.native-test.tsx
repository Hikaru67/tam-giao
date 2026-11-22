import { createApiClient } from '@tamgiao/api-client';
import type { PreferencesResponse } from '@tamgiao/contracts/profile';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { DEFAULT_PREFERENCES } from './use-preferences.js';
import { PreferencesScreen } from './preferences-screen.js';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
  }),
  useLocalSearchParams: () => ({}),
}));

const mockTokenStore = {
  getAccessToken: jest.fn(async () => 'mock-access-token'),
  getRefreshToken: jest.fn(async () => 'mock-refresh-token'),
  setTokens: jest.fn(async () => {}),
  clear: jest.fn(async () => {}),
};

const mockSavedPreferencesResponse: PreferencesResponse = {
  userId: '01952e46-953b-789a-b283-a9d701897d26',
  ageMin: 24,
  ageMax: 30,
  area: {
    city: 'Hà Nội',
    radiusKm: 50,
  },
  childrenPlan: 'want_children',
  religion: 'buddhism',
  lifestyle: {
    smoking: 'never',
    drinking: 'occasionally',
    dailyRhythm: 'early_bird',
    sports: 'regularly',
  },
  minEducation: 'master',
  financialIndependence: 'required',
  coreTraits: ['honest', 'loyal', 'patient'],
  updatedAt: '2026-11-22T10:00:00.000Z',
};

describe('PreferencesScreen (FE-S2-04)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lưu xong đọc lại hiển thị đúng: GET trả dữ liệu → hiển thị đúng tuổi và các chip tương ứng', async () => {
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/preferences') {
        return {
          status: 200,
          body: mockSavedPreferencesResponse,
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const queryClient = createTestQueryClient();
    const screen = await renderWithProviders(<PreferencesScreen />, {
      client,
      queryClient,
      tokenStore: mockTokenStore,
    });

    // Chờ dữ liệu load xong và kiểm tra hiển thị tuổi
    await waitFor(() => {
      expect(screen.getByText('24 – 30 tuổi')).toBeTruthy();
      expect(screen.getByTestId('age-min-value').props.children).toEqual([24, ' ', 'tuổi']);
      expect(screen.getByTestId('age-max-value').props.children).toEqual([30, ' ', 'tuổi']);
    });

    // Kiểm tra chip thành phố Hà Nội được chọn
    const hanoiChip = screen.getByLabelText('Hà Nội');
    expect(hanoiChip.props.accessibilityState.selected).toBe(true);

    // Kiểm tra chip tôn giáo Phật giáo được chọn
    const buddhismChip = screen.getByLabelText('Phật giáo');
    expect(buddhismChip.props.accessibilityState.selected).toBe(true);

    // Kiểm tra chip học vấn Thạc sĩ được chọn
    const masterChip = screen.getByLabelText('Thạc sĩ');
    expect(masterChip.props.accessibilityState.selected).toBe(true);

    // Kiểm tra 3 phẩm chất cốt lõi: Chân thành (honest), Chung thủy (loyal), Kiên nhẫn (patient)
    const honestChip = screen.getByLabelText('Chân thành');
    const loyalChip = screen.getByLabelText('Chung thủy');
    const patientChip = screen.getByLabelText('Kiên nhẫn');
    expect(honestChip.props.accessibilityState.selected).toBe(true);
    expect(loyalChip.props.accessibilityState.selected).toBe(true);
    expect(patientChip.props.accessibilityState.selected).toBe(true);

    // Counter hiển thị 3/3 đã chọn
    expect(screen.getByText('3/3 đã chọn')).toBeTruthy();

    await screen.unmount();
  });

  it('404 / chưa có tiêu chí: nạp giá trị mặc định hợp lệ theo schema', async () => {
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/preferences') {
        return {
          status: 404,
          body: createProblemBody({
            code: 'NOT_FOUND',
            status: 404,
            title: 'Chưa có tiêu chí bạn đời',
          }),
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const queryClient = createTestQueryClient();
    const screen = await renderWithProviders(<PreferencesScreen />, {
      client,
      queryClient,
      tokenStore: mockTokenStore,
    });

    // Màn hình nạp giá trị mặc định
    await waitFor(() => {
      expect(
        screen.getByText(`${DEFAULT_PREFERENCES.ageMin} – ${DEFAULT_PREFERENCES.ageMax} tuổi`),
      ).toBeTruthy();
      expect(screen.getByTestId('age-min-value').props.children).toEqual([
        DEFAULT_PREFERENCES.ageMin,
        ' ',
        'tuổi',
      ]);
      expect(screen.getByTestId('age-max-value').props.children).toEqual([
        DEFAULT_PREFERENCES.ageMax,
        ' ',
        'tuổi',
      ]);
    });

    expect(screen.getByText('3/3 đã chọn')).toBeTruthy();

    await screen.unmount();
  });

  it('ageMin > ageMax bị chặn ở stepper và nút tăng/giảm', async () => {
    // Trả về tiêu chí với ageMin = 28, ageMax = 28 (bằng nhau)
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/preferences') {
        return {
          status: 200,
          body: {
            ...mockSavedPreferencesResponse,
            ageMin: 28,
            ageMax: 28,
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const queryClient = createTestQueryClient();
    const screen = await renderWithProviders(<PreferencesScreen />, {
      client,
      queryClient,
      tokenStore: mockTokenStore,
    });

    await waitFor(() => {
      expect(screen.getByText('28 – 28 tuổi')).toBeTruthy();
    });

    // Khi ageMin == ageMax:
    // 1. Nút "Tăng tuổi tối thiểu" phải bị disable để chặn ageMin vượt qua ageMax
    const increaseMinBtn = screen.getByLabelText('Tăng tuổi tối thiểu');
    expect(increaseMinBtn.props.accessibilityState.disabled).toBe(true);

    // 2. Nút "Giảm tuổi tối đa" phải bị disable để chặn ageMax nhỏ hơn ageMin
    const decreaseMaxBtn = screen.getByLabelText('Giảm tuổi tối đa');
    expect(decreaseMaxBtn.props.accessibilityState.disabled).toBe(true);

    // Thử click nút tăng tuổi tối thiểu -> giá trị không đổi
    await act(async () => {
      await fireEvent.press(increaseMinBtn);
    });
    expect(screen.getByTestId('age-min-value').props.children).toEqual([28, ' ', 'tuổi']);

    // Thử click nút giảm tuổi tối đa -> giá trị không đổi
    await act(async () => {
      await fireEvent.press(decreaseMaxBtn);
    });
    expect(screen.getByTestId('age-max-value').props.children).toEqual([28, ' ', 'tuổi']);

    await screen.unmount();
  });

  it('chặn tuổi ngoài [MIN_AGE, 80]: không cho giảm dưới MIN_AGE và không cho tăng quá 80', async () => {
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/preferences') {
        return {
          status: 200,
          body: {
            ...mockSavedPreferencesResponse,
            ageMin: 20, // MIN_AGE
            ageMax: 80, // PREFERENCE_AGE_MAX
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const queryClient = createTestQueryClient();
    const screen = await renderWithProviders(<PreferencesScreen />, {
      client,
      queryClient,
      tokenStore: mockTokenStore,
    });

    await waitFor(() => {
      expect(screen.getByText('20 – 80 tuổi')).toBeTruthy();
    });

    // Nút "Giảm tuổi tối thiểu" bị disable vì ageMin đã chạm sàn 20
    const decreaseMinBtn = screen.getByLabelText('Giảm tuổi tối thiểu');
    expect(decreaseMinBtn.props.accessibilityState.disabled).toBe(true);

    // Nút "Tăng tuổi tối đa" bị disable vì ageMax đã chạm trần 80
    const increaseMaxBtn = screen.getByLabelText('Tăng tuổi tối đa');
    expect(increaseMaxBtn.props.accessibilityState.disabled).toBe(true);

    await screen.unmount();
  });

  it('PUT body đúng schema và khi thành công → invalidate [me] và replace(/)', async () => {
    let capturedPutBody: unknown = null;
    let putCalled = false;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/preferences') {
        if (init?.method === 'PUT') {
          putCalled = true;
          capturedPutBody = init?.body ? JSON.parse(init.body as string) : null;
          return {
            status: 200,
            body: {
              ...mockSavedPreferencesResponse,
              ...(capturedPutBody as object),
              userId: '01952e46-953b-789a-b283-a9d701897d26',
              updatedAt: new Date().toISOString(),
            },
          };
        }
        return {
          status: 200,
          body: mockSavedPreferencesResponse,
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const queryClient = createTestQueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const screen = await renderWithProviders(<PreferencesScreen />, {
      client,
      queryClient,
      tokenStore: mockTokenStore,
    });

    await waitFor(() => {
      expect(screen.getByText('24 – 30 tuổi')).toBeTruthy();
    });

    // Nhấn nút "Lưu tiêu chí & Quét hồ sơ tương hợp"
    const submitBtn = screen.getByText('Lưu tiêu chí & Quét hồ sơ tương hợp');
    await act(async () => {
      await fireEvent.press(submitBtn);
    });

    await waitFor(() => {
      expect(putCalled).toBe(true);
      expect(capturedPutBody).toEqual({
        ageMin: 24,
        ageMax: 30,
        area: {
          city: 'Hà Nội',
          radiusKm: 50,
        },
        childrenPlan: 'want_children',
        religion: 'buddhism',
        lifestyle: {
          smoking: 'never',
          drinking: 'occasionally',
          dailyRhythm: 'early_bird',
          sports: 'regularly',
        },
        minEducation: 'master',
        financialIndependence: 'required',
        coreTraits: ['honest', 'loyal', 'patient'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me'] });
      expect(mockReplace).toHaveBeenCalledWith('/');
    });

    await screen.unmount();
  });

  it('chọn không đủ 3 phẩm chất cốt lõi: bấm lưu hiện lỗi và không gửi PUT', async () => {
    let putCalled = false;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/preferences') {
        if (init?.method === 'PUT') {
          putCalled = true;
          return { status: 200, body: mockSavedPreferencesResponse };
        }
        return {
          status: 200,
          body: mockSavedPreferencesResponse,
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const queryClient = createTestQueryClient();
    const screen = await renderWithProviders(<PreferencesScreen />, {
      client,
      queryClient,
      tokenStore: mockTokenStore,
    });

    await waitFor(() => {
      expect(screen.getByText('3/3 đã chọn')).toBeTruthy();
    });

    // Bỏ chọn 1 phẩm chất ("Chân thành") -> còn 2/3
    const honestChip = screen.getByLabelText('Chân thành');
    await act(async () => {
      await fireEvent.press(honestChip);
    });

    expect(screen.getByText('2/3 đã chọn')).toBeTruthy();

    // Bấm lưu
    const submitBtn = screen.getByText('Lưu tiêu chí & Quét hồ sơ tương hợp');
    await act(async () => {
      await fireEvent.press(submitBtn);
    });

    // Thông báo lỗi hiện ra và không gọi PUT
    await waitFor(() => {
      expect(screen.getByText('Cần chọn đúng 3 phẩm chất cốt lõi')).toBeTruthy();
      expect(putCalled).toBe(false);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    await screen.unmount();
  });

  it('xử lý lỗi VALIDATION_FAILED từ server: hiển thị fieldErrors dưới đúng trường', async () => {
    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/preferences') {
        if (init?.method === 'PUT') {
          return {
            status: 422,
            body: createProblemBody({
              code: 'VALIDATION_FAILED',
              status: 422,
              title: 'Thông tin gửi lên chưa hợp lệ.',
              errors: [{ path: 'ageMax', message: '`ageMin` phải ≤ `ageMax`' }],
            }),
          };
        }
        return {
          status: 200,
          body: mockSavedPreferencesResponse,
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: mockTokenStore,
      fetch: fakeFetch,
    });

    const queryClient = createTestQueryClient();
    const screen = await renderWithProviders(<PreferencesScreen />, {
      client,
      queryClient,
      tokenStore: mockTokenStore,
    });

    await waitFor(() => {
      expect(screen.getByText('24 – 30 tuổi')).toBeTruthy();
    });

    const submitBtn = screen.getByText('Lưu tiêu chí & Quét hồ sơ tương hợp');
    await act(async () => {
      await fireEvent.press(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('`ageMin` phải ≤ `ageMax`')).toBeTruthy();
      expect(screen.getByText('Thông tin gửi lên chưa hợp lệ.')).toBeTruthy();
    });

    await screen.unmount();
  });
});
