import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { KYC_COPY } from './copy.js';
import { KycScreen } from './kyc-screen.js';
import type { KycSlot } from './types.js';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
}));

const mockDeletedUris: string[] = [];

jest.mock('expo-file-system', () => {
  class FakeFile {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return true;
    }
    delete() {
      mockDeletedUris.push(this.uri);
    }
    async arrayBuffer() {
      return new Uint8Array([1, 2, 3]).buffer;
    }
  }
  return {
    File: FakeFile,
  };
});

const mockManipulateAsync = jest.fn(async (uri: string) => ({
  uri: uri.replace('raw-', 'resized-'),
  width: 1500,
  height: 2000,
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(args[0] as string),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

const mockPhotoCounter = { value: 0 };
const mockPermission = {
  current: { granted: true, canAskAgain: true, status: 'granted' },
};
const mockRequestPermission = jest.fn(async () => {
  mockPermission.current = { granted: true, canAskAgain: true, status: 'granted' };
  return mockPermission.current;
});

jest.mock('expo-camera', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const CameraView = React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({
      takePictureAsync: async () => {
        mockPhotoCounter.value += 1;
        return {
          uri: `file:///cache/Camera/raw-${mockPhotoCounter.value}.jpg`,
          width: 3000,
          height: 4000,
        };
      },
    }));
    return React.createElement(View, { testID: 'kyc-camera-view', ...props });
  });
  return {
    CameraView,
    useCameraPermissions: () => [mockPermission.current, mockRequestPermission],
  };
});

const mockScreenCaptureProtection = jest.fn();
jest.mock('../security/use-screen-capture-protection', () => ({
  useScreenCaptureProtection: (...args: unknown[]) => mockScreenCaptureProtection(...args),
}));

const mockSecureStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

const DEFAULT_ME_RESPONSE = {
  userId: '01952e46-953b-789a-b283-a9d701897d26',
  onboardingStep: 'VERIFICATION',
  profile: null,
  badges: [],
  verificationPaid: true,
};

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

interface BuildFetchOptions {
  meResponse?: unknown;
  kycProgress?: unknown;
  onPostKyc?: (body: unknown) => { status?: number; body?: unknown };
  onPostUploads?: (body: unknown) => { status?: number; body?: unknown };
}

function buildFetch(options: BuildFetchOptions = {}) {
  let uploadCounter = 0;
  const recordedRequests: RecordedRequest[] = [];

  const fakeFetch = createFakeFetch((url, init) => {
    const method = init?.method ?? 'GET';
    let body: unknown = undefined;
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    recordedRequests.push({ url, method, body });

    if (url === 'http://api.test/me' && method === 'GET') {
      return { status: 200, body: options.meResponse ?? DEFAULT_ME_RESPONSE };
    }
    if (url === 'http://api.test/me/kyc' && method === 'GET') {
      return {
        status: 200,
        body: options.kycProgress ?? {
          status: 'NOT_SUBMITTED',
          submittedAt: null,
          decidedAt: null,
          steps: [
            { step: 'CCCD_CHIP', status: 'PENDING', decidedAt: null },
            { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
            { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
            { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
          ],
          moreInfo: null,
          rejectionReason: null,
        },
      };
    }
    if (url === 'http://api.test/uploads' && method === 'POST') {
      if (options.onPostUploads) {
        return options.onPostUploads(body);
      }
      uploadCounter += 1;
      const purpose = (body as { purpose?: string })?.purpose ?? 'kyc_doc';
      const key = `kyc/${purpose}/${uploadCounter}`;
      return {
        status: 200,
        body: {
          uploadId: '01952e46-953b-7aaa-8b11-000000000001',
          key,
          url: `https://storage.test/${key}`,
          method: 'PUT',
          headers: {},
          expiresAt: '2026-11-23T00:00:00.000Z',
        },
      };
    }
    if (method === 'PUT' && url.startsWith('https://storage.test/')) {
      return { status: 200, body: {} };
    }
    if (url === 'http://api.test/me/kyc' && method === 'POST') {
      if (options.onPostKyc) {
        return options.onPostKyc(body);
      }
      return {
        status: 201,
        body: {
          status: 'SUBMITTED',
          submittedAt: '2026-11-22T01:00:00.000Z',
          decidedAt: null,
          steps: [
            { step: 'CCCD_CHIP', status: 'PENDING', decidedAt: null },
            { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
            { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
            { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
          ],
          moreInfo: null,
          rejectionReason: null,
        },
      };
    }
    return { status: 404 };
  });

  return { fakeFetch, recordedRequests };
}

async function captureSlot(screen: Awaited<ReturnType<typeof renderWithProviders>>, slot: KycSlot) {
  const captureBtn = screen.getByTestId(`kyc-capture-${slot}`);
  await act(async () => {
    await fireEvent.press(captureBtn);
  });
  const shutterBtn = screen.getByTestId('kyc-camera-shutter');
  await act(async () => {
    await fireEvent.press(shutterBtn);
  });
  await waitFor(() => {
    expect(screen.getByTestId('kyc-preview-use')).toBeTruthy();
  });
  const useBtn = screen.getByTestId('kyc-preview-use');
  await act(async () => {
    await fireEvent.press(useBtn);
  });
  await waitFor(() => {
    expect(screen.getByTestId(`kyc-slot-status-${slot}`)).toBeTruthy();
  });
}

describe('KycScreen (FE-S3-02)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeletedUris.length = 0;
    mockPhotoCounter.value = 0;
    mockSecureStore.clear();
    mockPermission.current = { granted: true, canAskAgain: true, status: 'granted' };
  });

  it('1. Nộp lần đầu + AC1: chụp 4 slot, upload đúng purpose, submit đủ 4 key, xoá đúng 8 file tạm, lưu SecureStore, bật chặn chụp màn hình', async () => {
    const { fakeFetch, recordedRequests } = buildFetch();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<KycScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('kyc-slot-CCCD_FRONT')).toBeTruthy();
    });

    expect(mockScreenCaptureProtection).toHaveBeenCalledWith('kyc');
    expect(screen.queryByText(/VNeID|Bộ Công An|NFC/)).toBeNull();

    // Chụp lần lượt 4 slot
    await captureSlot(screen, 'CCCD_FRONT');
    await captureSlot(screen, 'CCCD_BACK');
    await captureSlot(screen, 'SELFIE');
    await captureSlot(screen, 'MARITAL_STATUS_CERTIFICATE');

    // Kiểm tra purpose của 4 lần upload
    const uploadRequests = recordedRequests.filter(
      (r) => r.url === 'http://api.test/uploads' && r.method === 'POST',
    );
    expect(uploadRequests).toHaveLength(4);
    expect((uploadRequests[0]?.body as { purpose?: string })?.purpose).toBe('kyc_doc');
    expect((uploadRequests[1]?.body as { purpose?: string })?.purpose).toBe('kyc_doc');
    expect((uploadRequests[2]?.body as { purpose?: string })?.purpose).toBe('kyc_selfie');
    expect((uploadRequests[3]?.body as { purpose?: string })?.purpose).toBe('kyc_doc');

    // Nút submit đã bật
    const submitBtn = screen.getByTestId('kyc-submit');
    expect(submitBtn.props.accessibilityState?.disabled).toBe(false);

    await act(async () => {
      await fireEvent.press(submitBtn);
    });

    // POST /me/kyc có đủ 4 key
    const submitRequest = recordedRequests.find(
      (r) => r.url === 'http://api.test/me/kyc' && r.method === 'POST',
    );
    expect(submitRequest).toBeTruthy();
    expect(submitRequest?.body).toEqual({
      cccdFrontKey: 'kyc/kyc_doc/1',
      cccdBackKey: 'kyc/kyc_doc/2',
      selfieKey: 'kyc/kyc_selfie/3',
      maritalStatusCertificateKey: 'kyc/kyc_doc/4',
    });

    expect(mockReplace).toHaveBeenCalledWith('/(verification)/status');

    // Mọi uri raw-N và resized-N đã tạo (4 raw + 4 resized = 8) đều đã bị xoá
    expect(mockDeletedUris).toHaveLength(8);
    for (let i = 1; i <= 4; i++) {
      expect(mockDeletedUris).toContain(`file:///cache/Camera/raw-${i}.jpg`);
      expect(mockDeletedUris).toContain(`file:///cache/Camera/resized-${i}.jpg`);
    }

    // SecureStore lưu key theo tg.kyc.docKeys.<userId>
    const stored = mockSecureStore.get('tg.kyc.docKeys.01952e46-953b-789a-b283-a9d701897d26');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toEqual({
      CCCD_FRONT: 'kyc/kyc_doc/1',
      CCCD_BACK: 'kyc/kyc_doc/2',
      SELFIE: 'kyc/kyc_selfie/3',
      MARITAL_STATUS_CERTIFICATE: 'kyc/kyc_doc/4',
    });

    await screen.unmount();
  });

  it('2. AC1 khi lỗi/huỷ: (a) upload lỗi 503 → slot failed, ảnh resize vẫn bị xoá; (b) bấm retake → ảnh resize cũ bị xoá; (c) unmount khi đang ở preview → ảnh resize bị xoá', async () => {
    // (a) Upload lỗi 503
    const { fakeFetch } = buildFetch({
      onPostUploads: () => ({
        status: 503,
        body: createProblemBody({
          code: 'SERVICE_UNAVAILABLE',
          status: 503,
          title: 'Hệ thống lưu trữ tạm thời gián đoạn',
        }),
      }),
    });
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screenA = await renderWithProviders(<KycScreen />, { client, queryClient });
    await waitFor(() => {
      expect(screenA.getByTestId('kyc-slot-CCCD_FRONT')).toBeTruthy();
    });

    await captureSlot(screenA, 'CCCD_FRONT');

    // Slot hiện failed và file resized vẫn bị xoá
    await waitFor(() => {
      expect(screenA.getByText(KYC_COPY.slotStatus.failed)).toBeTruthy();
    });
    expect(mockDeletedUris).toContain('file:///cache/Camera/raw-1.jpg');
    expect(mockDeletedUris).toContain('file:///cache/Camera/resized-1.jpg');
    await screenA.unmount();

    // (b) Preview bấm kyc-preview-retake → resized bị xoá
    mockDeletedUris.length = 0;
    const { fakeFetch: fetchB } = buildFetch();
    const clientB = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fetchB,
    });
    const queryClientB = createTestQueryClient();
    const screenB = await renderWithProviders(<KycScreen />, { client: clientB, queryClient: queryClientB });

    await waitFor(() => {
      expect(screenB.getByTestId('kyc-capture-CCCD_FRONT')).toBeTruthy();
    });
    await act(async () => {
      await fireEvent.press(screenB.getByTestId('kyc-capture-CCCD_FRONT'));
    });
    await act(async () => {
      await fireEvent.press(screenB.getByTestId('kyc-camera-shutter'));
    });
    await waitFor(() => {
      expect(screenB.getByTestId('kyc-preview-retake')).toBeTruthy();
    });

    // Bấm retake
    await act(async () => {
      await fireEvent.press(screenB.getByTestId('kyc-preview-retake'));
    });
    // raw và resized vừa chụp đều bị xoá
    expect(mockDeletedUris).toContain('file:///cache/Camera/resized-2.jpg');
    await screenB.unmount();

    // (c) Đang ở preview thì unmount → resized bị xoá
    mockDeletedUris.length = 0;
    const { fakeFetch: fetchC } = buildFetch();
    const clientC = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fetchC,
    });
    const queryClientC = createTestQueryClient();
    const screenC = await renderWithProviders(<KycScreen />, { client: clientC, queryClient: queryClientC });

    await waitFor(() => {
      expect(screenC.getByTestId('kyc-capture-CCCD_FRONT')).toBeTruthy();
    });
    await act(async () => {
      await fireEvent.press(screenC.getByTestId('kyc-capture-CCCD_FRONT'));
    });
    await act(async () => {
      await fireEvent.press(screenC.getByTestId('kyc-camera-shutter'));
    });
    await waitFor(() => {
      expect(screenC.getByTestId('kyc-preview-use')).toBeTruthy();
    });

    // Unmount khi đang ở preview
    await screenC.unmount();
    expect(mockDeletedUris).toContain('file:///cache/Camera/resized-3.jpg');
  });

  it('3. AC2 yêu cầu bổ sung: NEEDS_MORE_INFO + có key cũ trong SecureStore → hiển thị ghi chú, slot SELFIE cần chụp, 3 slot cũ tái sử dụng, nút Nộp bổ sung', async () => {
    mockSecureStore.set(
      'tg.kyc.docKeys.01952e46-953b-789a-b283-a9d701897d26',
      JSON.stringify({
        CCCD_FRONT: 'old-front-key',
        CCCD_BACK: 'old-back-key',
        SELFIE: 'old-selfie-key',
        MARITAL_STATUS_CERTIFICATE: 'old-marital-key',
      }),
    );

    const { fakeFetch, recordedRequests } = buildFetch({
      kycProgress: {
        status: 'NEEDS_MORE_INFO',
        submittedAt: '2026-11-20T00:00:00.000Z',
        decidedAt: null,
        steps: [
          { step: 'CCCD_CHIP', status: 'PENDING', decidedAt: null },
          { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
          { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
          { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
        ],
        moreInfo: {
          items: ['SELFIE'],
          note: 'Ảnh chân dung bị mờ',
        },
        rejectionReason: null,
      },
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<KycScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('kyc-more-info')).toBeTruthy();
    });

    expect(screen.getByText('Ảnh chân dung bị mờ')).toBeTruthy();
    expect(screen.getByText(`• ${KYC_COPY.moreInfo.items.SELFIE}`)).toBeTruthy();

    // SELFIE cần chụp lại, 3 slot khác dùng ảnh đã nộp
    const selfieStatus = screen.getByTestId('kyc-slot-status-SELFIE');
    expect(selfieStatus).toBeTruthy();
    expect(screen.getByText(KYC_COPY.slotStatus.required)).toBeTruthy();
    expect(screen.getAllByText(KYC_COPY.slotStatus.previous)).toHaveLength(3);

    // Submit disabled ban đầu
    const submitBtn = screen.getByTestId('kyc-submit');
    expect(submitBtn.props.accessibilityState?.disabled).toBe(true);

    // Chụp lại SELFIE
    await captureSlot(screen, 'SELFIE');

    // Chỉ có 1 POST /uploads với purpose kyc_selfie
    const uploadRequests = recordedRequests.filter(
      (r) => r.url === 'http://api.test/uploads' && r.method === 'POST',
    );
    expect(uploadRequests).toHaveLength(1);
    expect((uploadRequests[0]?.body as { purpose?: string })?.purpose).toBe('kyc_selfie');

    // Nút đổi chữ thành "Nộp bổ sung"
    expect(screen.getByText(KYC_COPY.actions.resubmit)).toBeTruthy();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('kyc-submit'));
    });

    // POST /me/kyc gửi 3 key cũ + 1 key selfie mới
    const submitRequest = recordedRequests.find(
      (r) => r.url === 'http://api.test/me/kyc' && r.method === 'POST',
    );
    expect(submitRequest?.body).toEqual({
      cccdFrontKey: 'old-front-key',
      cccdBackKey: 'old-back-key',
      selfieKey: 'kyc/kyc_selfie/1',
      maritalStatusCertificateKey: 'old-marital-key',
    });

    await screen.unmount();
  });

  it('4. AC2 không có key cũ: NEEDS_MORE_INFO items [CCCD_BACK], SecureStore rỗng → cả 4 slot đều phải chụp lại', async () => {
    const { fakeFetch } = buildFetch({
      kycProgress: {
        status: 'NEEDS_MORE_INFO',
        submittedAt: '2026-11-20T00:00:00.000Z',
        decidedAt: null,
        steps: [
          { step: 'CCCD_CHIP', status: 'PENDING', decidedAt: null },
          { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
          { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
          { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
        ],
        moreInfo: {
          items: ['CCCD_BACK'],
          note: null,
        },
        rejectionReason: null,
      },
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<KycScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('kyc-slot-CCCD_BACK')).toBeTruthy();
    });

    // Chỉ chụp CCCD_BACK
    await captureSlot(screen, 'CCCD_BACK');

    // Submit vẫn disabled vì 3 slot còn lại chưa có
    const submitBtn = screen.getByTestId('kyc-submit');
    expect(submitBtn.props.accessibilityState?.disabled).toBe(true);

    await screen.unmount();
  });

  it('5. PAYMENT_REQUIRED khi POST /me/kyc (403 Problem) → hiển thị lỗi và nút điều hướng đến thanh toán', async () => {
    const { fakeFetch } = buildFetch({
      onPostKyc: () => ({
        status: 403,
        body: createProblemBody({
          code: 'PAYMENT_REQUIRED',
          status: 403,
          title: 'Cần thanh toán phí xác thực trước khi nộp hồ sơ.',
        }),
      }),
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<KycScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('kyc-slot-CCCD_FRONT')).toBeTruthy();
    });

    await captureSlot(screen, 'CCCD_FRONT');
    await captureSlot(screen, 'CCCD_BACK');
    await captureSlot(screen, 'SELFIE');
    await captureSlot(screen, 'MARITAL_STATUS_CERTIFICATE');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('kyc-submit'));
    });

    const expectedTitle = messageFor({ code: 'PAYMENT_REQUIRED' }).title;
    await waitFor(() => {
      expect(screen.getByText(expectedTitle)).toBeTruthy();
      expect(screen.getByTestId('kyc-go-payment')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('kyc-go-payment'));
    });

    expect(mockReplace).toHaveBeenCalledWith('/(verification)/payment');

    await screen.unmount();
  });

  it('6. KYC_ALREADY_SUBMITTED (409) → hiển thị thông báo và nút xem trạng thái', async () => {
    const { fakeFetch } = buildFetch({
      onPostKyc: () => ({
        status: 409,
        body: createProblemBody({
          code: 'KYC_ALREADY_SUBMITTED',
          status: 409,
          title: 'Hồ sơ đã được nộp trước đó.',
        }),
      }),
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<KycScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('kyc-slot-CCCD_FRONT')).toBeTruthy();
    });

    await captureSlot(screen, 'CCCD_FRONT');
    await captureSlot(screen, 'CCCD_BACK');
    await captureSlot(screen, 'SELFIE');
    await captureSlot(screen, 'MARITAL_STATUS_CERTIFICATE');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('kyc-submit'));
    });

    const expectedTitle = messageFor({ code: 'KYC_ALREADY_SUBMITTED' }).title;
    await waitFor(() => {
      expect(screen.getByText(expectedTitle)).toBeTruthy();
      expect(screen.getByTestId('kyc-go-status')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('kyc-go-status'));
    });

    expect(mockReplace).toHaveBeenCalledWith('/(verification)/status');

    await screen.unmount();
  });

  it('7. UPLOAD_NOT_OWNED khi nộp bổ sung với meta.field: cccdFrontKey → slot CCCD_FRONT về trạng thái cần chụp, submit disabled', async () => {
    mockSecureStore.set(
      'tg.kyc.docKeys.01952e46-953b-789a-b283-a9d701897d26',
      JSON.stringify({
        CCCD_FRONT: 'old-front-key',
        CCCD_BACK: 'old-back-key',
        SELFIE: 'old-selfie-key',
        MARITAL_STATUS_CERTIFICATE: 'old-marital-key',
      }),
    );

    const { fakeFetch } = buildFetch({
      kycProgress: {
        status: 'NEEDS_MORE_INFO',
        submittedAt: '2026-11-20T00:00:00.000Z',
        decidedAt: null,
        steps: [
          { step: 'CCCD_CHIP', status: 'PENDING', decidedAt: null },
          { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
          { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
          { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
        ],
        moreInfo: {
          items: ['SELFIE'],
          note: null,
        },
        rejectionReason: null,
      },
      onPostKyc: () => ({
        status: 400,
        body: createProblemBody({
          code: 'UPLOAD_NOT_OWNED',
          status: 400,
          title: 'Tệp tải lên không thuộc quyền sở hữu của bạn.',
          meta: { field: 'cccdFrontKey' },
        }),
      }),
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<KycScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('kyc-slot-SELFIE')).toBeTruthy();
    });

    await captureSlot(screen, 'SELFIE');

    // Submit và nhận lỗi UPLOAD_NOT_OWNED ở cccdFrontKey
    await act(async () => {
      await fireEvent.press(screen.getByTestId('kyc-submit'));
    });

    // CCCD_FRONT quay về trạng thái cần chụp lại và submit bị disabled
    await waitFor(() => {
      const frontStatus = screen.getByTestId('kyc-slot-status-CCCD_FRONT');
      expect(frontStatus).toBeTruthy();
    });

    const submitBtn = screen.getByTestId('kyc-submit');
    expect(submitBtn.props.accessibilityState?.disabled).toBe(true);

    await screen.unmount();
  });

  it('8. GET /me/kyc UNDER_REVIEW → hiện kyc-already-submitted, bấm kyc-view-status → mockReplace gọi /(verification)/status', async () => {
    const { fakeFetch } = buildFetch({
      kycProgress: {
        status: 'UNDER_REVIEW',
        submittedAt: '2026-11-22T00:00:00.000Z',
        decidedAt: null,
        steps: [
          { step: 'CCCD_CHIP', status: 'PENDING', decidedAt: null },
          { step: 'MARITAL_STATUS', status: 'PENDING', decidedAt: null },
          { step: 'MANUAL_REVIEW', status: 'PENDING', decidedAt: null },
          { step: 'INTERVIEW', status: 'PENDING', decidedAt: null },
        ],
        moreInfo: null,
        rejectionReason: null,
      },
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<KycScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('kyc-already-submitted')).toBeTruthy();
    });

    expect(screen.getByText(KYC_COPY.submitted.title)).toBeTruthy();
    expect(screen.getByText(KYC_COPY.submitted.body)).toBeTruthy();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('kyc-view-status'));
    });

    expect(mockReplace).toHaveBeenCalledWith('/(verification)/status');

    await screen.unmount();
  });

  it('9. Quyền camera bị từ chối → bấm capture → thấy kyc-camera-grant, bấm → mockRequestPermission được gọi', async () => {
    mockPermission.current = { granted: false, canAskAgain: true, status: 'denied' };

    const { fakeFetch } = buildFetch();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<KycScreen />, { client, queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('kyc-capture-CCCD_FRONT')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('kyc-capture-CCCD_FRONT'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('kyc-camera-grant')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('kyc-camera-grant'));
    });

    expect(mockRequestPermission).toHaveBeenCalled();

    await screen.unmount();
  });
});
