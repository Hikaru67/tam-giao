import type { createElement as CreateElement } from 'react';
import type { View as RNView } from 'react-native';
import { createApiClient } from '@tamgiao/api-client';
import { MIN_AGE } from '@tamgiao/contracts/constants';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { PROFILE_COPY } from './copy.js';
import { ProfileScreen } from './profile-screen.js';

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

const mockLaunchImageLibraryAsync = jest.fn();
const mockLaunchCameraAsync = jest.fn();
const mockRequestMediaLibraryPermissionsAsync = jest.fn(async () => ({
  granted: true,
  status: 'granted',
}));
const mockRequestCameraPermissionsAsync = jest.fn(async () => ({
  granted: true,
  status: 'granted',
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCameraAsync(...args),
  requestMediaLibraryPermissionsAsync: () => mockRequestMediaLibraryPermissionsAsync(),
  requestCameraPermissionsAsync: () => mockRequestCameraPermissionsAsync(),
  MediaTypeOptions: { Images: 'images' },
}));

const mockManipulateAsync = jest.fn(async (...args: unknown[]) => ({
  uri: String(args[0]),
  width: 1000,
  height: 1000,
}));

jest.mock('./local-file.js', () => ({
  readLocalFile: jest.fn(async () => new Blob(['jpeg-bytes'], { type: 'image/jpeg', lastModified: 0 })),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...args),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

jest.mock('@react-native-community/datetimepicker', () => {
  // Factory jest.mock không được dùng import ngoài → requireActual (thay cho require bị lint cấm).
  const { createElement } = jest.requireActual('react') as { createElement: typeof CreateElement };
  const { View } = jest.requireActual('react-native') as { View: typeof RNView };
  return {
    __esModule: true,
    default: function MockDateTimePicker(props: Record<string, unknown>) {
      return createElement(View, { testID: 'mock-date-picker', ...props });
    },
  };
});

const DEFAULT_PROFILE_RESPONSE = {
  userId: '01952e46-953b-789a-b283-a9d701897d26',
  status: 'DRAFT',
  fullName: null,
  birthDate: null,
  gender: null,
  hometown: null,
  currentCity: null,
  education: null,
  occupation: null,
  religion: null,
  childrenPlan: null,
  bio: null,
  interests: [],
  incomeRange: null,
  housing: null,
  assets: null,
  photos: [],
  completedAt: null,
  updatedAt: '2026-11-22T00:00:00.000Z',
};

describe('ProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('validate tuổi < MIN_AGE: hiển thị lỗi và chặn submit lên API', async () => {
    let putCalled = false;

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/profile') {
        if (init?.method === 'PUT') {
          putCalled = true;
          return { status: 200, body: DEFAULT_PROFILE_RESPONSE };
        }
        return { status: 200, body: DEFAULT_PROFILE_RESPONSE };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: {
        getAccessToken: jest.fn(async () => 'valid-access-token'),
        getRefreshToken: jest.fn(async () => null),
        setTokens: jest.fn(),
        clear: jest.fn(),
      },
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<ProfileScreen />, { client });

    // Điền ngày sinh chưa đủ tuổi (dưới MIN_AGE 20 tuổi)
    const birthDateInput = await screen.findByLabelText(PROFILE_COPY.personalInfo.birthDateLabel);
    await act(async () => {
      await fireEvent.changeText(birthDateInput, '2012-05-15');
    });

    // Điền các trường khác
    const fullNameInput = screen.getByLabelText(PROFILE_COPY.personalInfo.fullNameLabel);
    await act(async () => {
      await fireEvent.changeText(fullNameInput, 'Trần Minh Quân');
    });

    const submitBtn = screen.getByRole('button', { name: PROFILE_COPY.footer.submitButton });
    await act(async () => {
      await fireEvent.press(submitBtn);
    });

    // Phải hiển thị lỗi tuổi và KHÔNG được gọi PUT /me/profile
    await waitFor(() => {
      expect(screen.getByText(PROFILE_COPY.errors.ageUnderMin(MIN_AGE))).toBeTruthy();
      expect(putCalled).toBe(false);
    });

    await screen.unmount();
  });

  it('ảnh thứ MAX_PROFILE_PHOTOS + 1 bị chặn ở client: không gọi picker và hiện thông báo lỗi', async () => {
    // Hồ sơ ban đầu đã có đủ 5 ảnh (MAX_PROFILE_PHOTOS)
    const fullPhotosProfile = {
      ...DEFAULT_PROFILE_RESPONSE,
      photos: [
        { key: 'photo-1', url: 'http://img.test/1.jpg' },
        { key: 'photo-2', url: 'http://img.test/2.jpg' },
        { key: 'photo-3', url: 'http://img.test/3.jpg' },
        { key: 'photo-4', url: 'http://img.test/4.jpg' },
        { key: 'photo-5', url: 'http://img.test/5.jpg' },
      ],
    };

    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/profile') {
        return { status: 200, body: fullPhotosProfile };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: {
        getAccessToken: jest.fn(async () => 'valid-access-token'),
        getRefreshToken: jest.fn(async () => null),
        setTokens: jest.fn(),
        clear: jest.fn(),
      },
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<ProfileScreen />, { client });

    await waitFor(() => {
      // Đã tải xong và có đủ 5 ảnh
      expect(screen.queryByText(PROFILE_COPY.photos.addPhoto)).toBeNull();
    });

    // Khi đã có 5 ảnh, mock picker không được phép được gọi
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled();
    expect(mockLaunchCameraAsync).not.toHaveBeenCalled();

    await screen.unmount();
  });

  it('PUT body đúng (gồm key ảnh đã upload) khi bấm Lưu & Tiếp tục', async () => {
    let capturedPutBody: unknown = null;

    mockLaunchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///data/photo-user-1.jpg', width: 1200, height: 1200 }],
    });

    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/profile') {
        if (init?.method === 'PUT') {
          capturedPutBody = init?.body ? JSON.parse(init.body as string) : null;
          return { status: 200, body: DEFAULT_PROFILE_RESPONSE };
        }
        return { status: 200, body: DEFAULT_PROFILE_RESPONSE };
      }
      if (url === 'http://api.test/uploads') {
        return {
          status: 200,
          body: {
            uploadId: '01952e46-953b-789a-b283-a9d701897d26',
            key: 'profile_photos/user-1/uploaded-photo-key.jpg',
            url: 'http://storage.test/profile_photos/user-1/uploaded-photo-key.jpg',
            method: 'PUT',
            headers: { 'content-type': 'image/jpeg' },
            expiresAt: '2026-11-23T00:00:00.000Z',
          },
        };
      }
      if (url.startsWith('http://storage.test/')) {
        return { status: 200 };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: {
        getAccessToken: jest.fn(async () => 'valid-access-token'),
        getRefreshToken: jest.fn(async () => null),
        setTokens: jest.fn(),
        clear: jest.fn(),
      },
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<ProfileScreen />, { client });

    // 1. Thêm ảnh từ thư viện
    const addPhotoBtn = await screen.findByLabelText(PROFILE_COPY.photos.mainPhotoTitle);
    await act(async () => {
      await fireEvent.press(addPhotoBtn);
    });

    const fromLibraryBtn = screen.getByLabelText(PROFILE_COPY.photos.fromLibrary);
    await act(async () => {
      await fireEvent.press(fromLibraryBtn);
    });

    await waitFor(() => {
      expect(mockLaunchImageLibraryAsync).toHaveBeenCalled();
    });

    // 2. Điền các trường thông tin
    const fullNameInput = screen.getByLabelText(PROFILE_COPY.personalInfo.fullNameLabel);
    await act(async () => {
      await fireEvent.changeText(fullNameInput, 'Nguyễn Văn An');
    });

    const birthDateInput = screen.getByLabelText(PROFILE_COPY.personalInfo.birthDateLabel);
    await act(async () => {
      await fireEvent.changeText(birthDateInput, '1995-03-10');
    });

    const genderBtn = screen.getByLabelText(PROFILE_COPY.personalInfo.genderMale);
    await act(async () => {
      await fireEvent.press(genderBtn);
    });

    const currentCityInput = screen.getByLabelText(PROFILE_COPY.personalInfo.currentCityLabel);
    await act(async () => {
      await fireEvent.changeText(currentCityInput, 'TP. Hồ Chí Minh');
    });

    const educationBtn = screen.getByLabelText(PROFILE_COPY.educationOptions.bachelor);
    await act(async () => {
      await fireEvent.press(educationBtn);
    });

    const occupationInput = screen.getByLabelText(PROFILE_COPY.personalInfo.occupationLabel);
    await act(async () => {
      await fireEvent.changeText(occupationInput, 'Kỹ sư phần mềm');
    });

    const religionBtn = screen.getByLabelText(PROFILE_COPY.religionOptions.none);
    await act(async () => {
      await fireEvent.press(religionBtn);
    });

    const childrenPlanBtn = screen.getByLabelText(PROFILE_COPY.childrenPlanOptions.want_children);
    await act(async () => {
      await fireEvent.press(childrenPlanBtn);
    });

    const bioInput = screen.getByLabelText(PROFILE_COPY.lifestyleInfo.bioLabel);
    await act(async () => {
      await fireEvent.changeText(bioInput, 'Mong muốn tìm kiếm người bạn đời cùng chia sẻ.');
    });

    // 3. Bấm Lưu & Tiếp tục
    const submitBtn = screen.getByRole('button', { name: PROFILE_COPY.footer.submitButton });
    await act(async () => {
      await fireEvent.press(submitBtn);
    });

    // Kiểm tra body gửi lên có chứa đúng key ảnh đã upload
    await waitFor(() => {
      expect(capturedPutBody).toEqual({
        fullName: 'Nguyễn Văn An',
        birthDate: '1995-03-10',
        gender: 'male',
        hometown: null,
        currentCity: 'TP. Hồ Chí Minh',
        education: 'bachelor',
        occupation: 'Kỹ sư phần mềm',
        religion: 'none',
        childrenPlan: 'want_children',
        bio: 'Mong muốn tìm kiếm người bạn đời cùng chia sẻ.',
        interests: [],
        incomeRange: null,
        housing: null,
        assets: null,
        photos: ['profile_photos/user-1/uploaded-photo-key.jpg'],
        submit: true,
      });
    });

    await screen.unmount();
  });

  it('lỗi VALIDATION_FAILED với errors:[{path: "bio", message: "..."}] hiển thị ngay dưới trường tự bạch', async () => {
    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/profile') {
        if (init?.method === 'PUT') {
          return {
            status: 422,
            body: createProblemBody({
              code: 'VALIDATION_FAILED',
              status: 422,
              title: 'Dữ liệu đầu vào không hợp lệ',
              errors: [
                {
                  path: 'bio',
                  message: 'Đoạn tự bạch không được chứa thông tin liên lạc cá nhân.',
                },
              ],
            }),
          };
        }
        return { status: 200, body: DEFAULT_PROFILE_RESPONSE };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: {
        getAccessToken: jest.fn(async () => 'valid-access-token'),
        getRefreshToken: jest.fn(async () => null),
        setTokens: jest.fn(),
        clear: jest.fn(),
      },
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<ProfileScreen />, { client });

    // Bấm Lưu tạm (submit: false)
    const saveDraftBtn = await screen.findByRole('button', { name: PROFILE_COPY.header.saveDraft });
    await act(async () => {
      await fireEvent.press(saveDraftBtn);
    });

    // Lỗi trả về từ server cho trường bio phải hiển thị dưới trường bio
    await waitFor(() => {
      expect(screen.getByText('Đoạn tự bạch không được chứa thông tin liên lạc cá nhân.')).toBeTruthy();
    });

    await screen.unmount();
  });

  it('thành công → invalidate ["me"], ["profile"] và gọi router.replace("/")', async () => {
    const fakeFetch = createFakeFetch((url, init) => {
      if (url === 'http://api.test/me/profile') {
        if (init?.method === 'PUT') {
          return {
            status: 200,
            body: {
              ...DEFAULT_PROFILE_RESPONSE,
              status: 'COMPLETED',
              fullName: 'Lê Văn C',
            },
          };
        }
        return {
          status: 200,
          body: {
            ...DEFAULT_PROFILE_RESPONSE,
            fullName: 'Lê Văn C',
            birthDate: '1990-01-01',
            gender: 'male',
            currentCity: 'Hà Nội',
            education: 'master',
            occupation: 'Kiến trúc sư',
            religion: 'buddhism',
            childrenPlan: 'open',
            photos: [{ key: 'photo-key-1', url: 'http://img.test/c.jpg' }],
          },
        };
      }
      return { status: 404 };
    });

    const queryClient = createTestQueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: {
        getAccessToken: jest.fn(async () => 'valid-access-token'),
        getRefreshToken: jest.fn(async () => null),
        setTokens: jest.fn(),
        clear: jest.fn(),
      },
      fetch: fakeFetch,
    });

    const screen = await renderWithProviders(<ProfileScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Lê Văn C')).toBeTruthy();
    });

    const submitBtn = screen.getByRole('button', { name: PROFILE_COPY.footer.submitButton });
    await act(async () => {
      await fireEvent.press(submitBtn);
    });

    await waitFor(() => {
      // Invalidate cả me và profile
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['profile'] });
      // Điều hướng về / để EntryScreen quyết định bước tiếp theo
      expect(mockReplace).toHaveBeenCalledWith('/');
    });

    await screen.unmount();
  });
});
