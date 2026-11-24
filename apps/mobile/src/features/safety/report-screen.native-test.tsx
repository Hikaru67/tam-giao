import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import { SAFETY_RESPONSE_SLA_MINUTES } from '@tamgiao/contracts/constants';
import type { CurrentMatchDto } from '@tamgiao/contracts/matching';
import type { ConversationSummaryDto } from '@tamgiao/contracts/messaging';
import {
  REPORT_CATEGORY_NAMES,
  REPORT_MAX_EVIDENCE,
  type FileReportResponse,
} from '@tamgiao/contracts/safety';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { createFakeChatClient } from '../../test-utils/fake-chat-client.js';
import {
  createFakeFetch,
  createProblemBody,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import { ChatClientProvider } from '../chat/chat-client-context.js';
import { ChatScreen } from '../chat/chat-screen.js';
import { REPORT_CATEGORIES_COPY, REPORT_COPY, SAFETY_CENTER_COPY } from './copy.js';
import { ReportScreen } from './report-screen.js';
import { SafetyCenterScreen } from './safety-center-screen.js';

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

const mockPreventScreenCapture = jest.fn();
jest.mock('expo-screen-capture', () => ({
  usePreventScreenCapture: (...args: unknown[]) => mockPreventScreenCapture(...args),
}));

const mockLaunchImageLibraryAsync = jest.fn();
const mockRequestMediaLibraryPermissionsAsync = jest.fn(async () => ({
  granted: true,
  status: 'granted',
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
  requestMediaLibraryPermissionsAsync: () => mockRequestMediaLibraryPermissionsAsync(),
  MediaTypeOptions: { Images: 'images' },
}));

const mockManipulateAsync = jest.fn(async (uri: unknown) => ({
  uri: `${String(uri)}-manipulated.jpg`,
  width: 1200,
  height: 800,
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(args[0]),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

const mockReadLocalFile = jest.fn(
  async (_uri: unknown) => new Blob(['jpeg-bytes'], { type: 'image/jpeg', lastModified: 0 }),
);
jest.mock('../profile/local-file.js', () => ({
  readLocalFile: (uri: unknown) => mockReadLocalFile(uri),
}));

const mockDeleteTempPhoto = jest.fn();
jest.mock('../kyc/temp-photo.js', () => ({
  deleteTempPhoto: (...args: unknown[]) => mockDeleteTempPhoto(...args),
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

const CONVERSATION_ID = '01890a5d-ac96-774b-bcce-b302099a8001';
const PEER_USER_ID = '01890a5d-ac96-774b-bcce-b302099a8003';
const MATCH_ID = '01890a5d-ac96-774b-bcce-b302099a8050';
const REPORT_ID = '01890a5d-ac96-774b-bcce-b302099a8088';

const DEFAULT_MATCH: CurrentMatchDto = {
  matchId: MATCH_ID,
  status: 'DATING',
  phase: 'DATING',
  offeredAt: '2026-11-19T00:00:00.000Z',
  datingStartedAt: '2026-11-20T00:00:00.000Z',
  score: null,
  commonPoints: [],
  staffNote: null,
  counterpart: {
    userId: PEER_USER_ID,
    displayName: 'Minh Trang',
    age: 28,
    currentCity: 'TP. Hồ Chí Minh',
    occupation: 'Kiểm toán',
    education: 'bachelor',
    avatar: null,
  },
  expiresAt: '2026-12-04T00:00:00.000Z',
};

const DEFAULT_SUMMARY: ConversationSummaryDto = {
  conversationId: CONVERSATION_ID,
  peerUserId: PEER_USER_ID,
  status: 'OPEN',
  openedAt: '2026-11-20T00:00:00.000Z',
  closesAt: '2026-12-04T00:00:00.000Z',
  datingDay: 4,
  datingDays: 14,
  lastMessage: null,
  unreadCount: 0,
  lastReadMessageId: null,
};

describe('FE-S4-06 Safety Center & Report Screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReceivedListeners.length = 0;
  });

  // a. đủ mọi loại trong REPORT_CATEGORY_NAMES; nút gửi disabled khi chưa chọn.
  it('a. renders all category options and disables submit button when none is selected', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes('/me/match')) return { status: 200, body: { match: DEFAULT_MATCH } };
        return { status: 200, body: {} };
      }),
    });

    const screen = await renderWithProviders(<ReportScreen reportedUserId={PEER_USER_ID} />, {
      client,
    });

    for (const cat of REPORT_CATEGORY_NAMES) {
      const option = screen.getByTestId(`report-category-${cat}`);
      expect(option).toBeTruthy();
      expect(screen.getByText(REPORT_CATEGORIES_COPY[cat].label)).toBeTruthy();
      expect(screen.getByText(REPORT_CATEGORIES_COPY[cat].description)).toBeTruthy();
    }

    expect(screen.getByTestId('report-submit').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByTestId(`report-category-${REPORT_CATEGORY_NAMES[0]}`));

    await waitFor(() => {
      expect(screen.getByTestId('report-submit').props.accessibilityState.disabled).toBe(false);
    });

    await screen.unmount();
  });

  // b. gửi đủ: body đúng (description trim, evidenceKeys, urgentIntervention true) → report-sent với SLA phút.
  it('b. submits report with all fields: trimmed description, evidenceKeys, urgentIntervention and displays report-sent with SLA', async () => {
    let capturedBody: unknown = null;
    let uploadCount = 0;

    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photo-1.jpg', width: 1200, height: 800 }],
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url, init) => {
        if (url.includes('/me/reports') && init?.method === 'POST') {
          capturedBody = JSON.parse(init.body as string);
          const response: FileReportResponse = {
            reportId: REPORT_ID,
            status: 'OPEN',
            category: 'MARITAL_FRAUD',
            severity: 'CRITICAL',
            urgent: true,
            dueAt: new Date(Date.now() + SAFETY_RESPONSE_SLA_MINUTES * 60_000).toISOString(),
            createdAt: '2026-11-24T10:00:00.000Z',
          };
          return { status: 201, body: response };
        }
        if (url.includes('/me/match')) {
          return { status: 200, body: { match: DEFAULT_MATCH } };
        }
        return { status: 200, body: {} };
      }),
    });

    client.upload = jest.fn(async () => {
      uploadCount++;
      return { key: `evidence-key-${uploadCount}`, uploadId: `u-${uploadCount}` };
    });

    const screen = await renderWithProviders(<ReportScreen reportedUserId={PEER_USER_ID} />, { client });

    // Chọn danh mục
    await fireEvent.press(screen.getByTestId('report-category-MARITAL_FRAUD'));

    // Nhập mô tả với khoảng trắng ở hai đầu
    const descInput = screen.getByTestId('report-description');
    await fireEvent.changeText(descInput, '   Đối phương đã có gia đình   ');

    // Thêm ảnh bằng chứng
    const addEvidenceBtn = screen.getByTestId('report-add-evidence');
    await fireEvent.press(addEvidenceBtn);

    // Chờ ảnh upload xong
    await waitFor(() => {
      expect(client.upload).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('report-submit').props.accessibilityState.disabled).toBe(false);
    });

    // Bật cờ khẩn cấp
    const urgentSwitch = screen.getByTestId('report-urgent');
    await fireEvent(urgentSwitch, 'valueChange', true);

    // Bấm nút gửi
    await fireEvent.press(screen.getByTestId('report-submit'));

    // Chờ BottomSheet xác nhận hiện ra
    await waitFor(() => {
      expect(screen.getByTestId('report-confirm')).toBeTruthy();
    });

    // Bấm xác nhận gửi
    await fireEvent.press(screen.getByTestId('report-confirm-submit'));

    // Chờ hiển thị report-sent với SLA phút
    await waitFor(() => {
      expect(screen.getByTestId('report-sent')).toBeTruthy();
    });

    expect(screen.getByText(REPORT_COPY.sent.urgentNotice(SAFETY_RESPONSE_SLA_MINUTES))).toBeTruthy();

    expect(capturedBody).toEqual({
      reportedUserId: PEER_USER_ID,
      category: 'MARITAL_FRAUD',
      description: 'Đối phương đã có gia đình',
      evidenceKeys: ['evidence-key-1'],
      urgentIntervention: true,
    });

    // Bấm nút về trang chính
    const homeBtn = screen.getByTestId('report-sent-home');
    await fireEvent.press(homeBtn);
    expect(mockReplace).toHaveBeenCalledWith('/(main)/home');

    await screen.unmount();
  });

  // c. không mô tả/ảnh → body không có hai khoá.
  it('c. omits description and evidenceKeys from body when empty', async () => {
    let capturedBody: Record<string, unknown> | null = null;

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url, init) => {
        if (url.includes('/me/reports') && init?.method === 'POST') {
          capturedBody = JSON.parse(init.body as string);
          const response: FileReportResponse = {
            reportId: REPORT_ID,
            status: 'OPEN',
            category: 'FINANCIAL_SCAM',
            severity: 'HIGH',
            urgent: false,
            dueAt: null,
            createdAt: '2026-11-24T10:00:00.000Z',
          };
          return { status: 201, body: response };
        }
        return { status: 200, body: {} };
      }),
    });

    const screen = await renderWithProviders(<ReportScreen reportedUserId={PEER_USER_ID} />, { client });

    await fireEvent.press(screen.getByTestId('report-category-FINANCIAL_SCAM'));

    // Nhập chỉ khoảng trắng
    await fireEvent.changeText(screen.getByTestId('report-description'), '     ');

    await fireEvent.press(screen.getByTestId('report-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('report-confirm')).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId('report-confirm-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('report-sent')).toBeTruthy();
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody).not.toHaveProperty('description');
    expect(capturedBody).not.toHaveProperty('evidenceKeys');
    expect(capturedBody).toEqual({
      reportedUserId: PEER_USER_ID,
      category: 'FINANCIAL_SCAM',
    });

    await screen.unmount();
  });

  // d. tối đa REPORT_MAX_EVIDENCE ảnh → nút thêm ẩn; xoá → hiện lại.
  it('d. hides add evidence button when maximum photos reached and shows it again on removal', async () => {
    let pickCounter = 0;
    mockLaunchImageLibraryAsync.mockImplementation(async () => {
      pickCounter++;
      return {
        canceled: false,
        assets: [{ uri: `file:///photo-${pickCounter}.jpg`, width: 1200, height: 800 }],
      };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch(() => ({ status: 200, body: {} })),
    });

    client.upload = jest.fn(async () => ({
      key: `evidence-key-${pickCounter}`,
      uploadId: `u-${pickCounter}`,
    }));

    const screen = await renderWithProviders(<ReportScreen reportedUserId={PEER_USER_ID} />, { client });

    for (let i = 0; i < REPORT_MAX_EVIDENCE; i++) {
      expect(screen.queryByTestId('report-add-evidence')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('report-add-evidence'));
      await waitFor(() => {
        expect(screen.getByTestId(`report-remove-evidence-${i}`)).toBeTruthy();
      });
    }

    // Nút thêm ảnh bị ẩn khi đã đủ REPORT_MAX_EVIDENCE
    expect(screen.queryByTestId('report-add-evidence')).toBeNull();

    // Xoá ảnh đầu tiên
    await fireEvent.press(screen.getByTestId('report-remove-evidence-0'));

    // Nút thêm ảnh hiện lại
    await waitFor(() => {
      expect(screen.getByTestId('report-add-evidence')).toBeTruthy();
    });

    await screen.unmount();
  });

  // e. ảnh tải lỗi → thử lại → key có trong body; ảnh lỗi chưa thử lại không nằm trong body.
  it('e. includes retried photo in evidenceKeys and excludes failed unretried photo', async () => {
    let pickCounter = 0;
    mockLaunchImageLibraryAsync.mockImplementation(async () => {
      pickCounter++;
      return {
        canceled: false,
        assets: [{ uri: `file:///photo-${pickCounter}.jpg`, width: 1200, height: 800 }],
      };
    });

    let capturedBody: Record<string, unknown> | null = null;
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url, init) => {
        if (url.includes('/me/reports') && init?.method === 'POST') {
          capturedBody = JSON.parse(init.body as string);
          return {
            status: 201,
            body: {
              reportId: REPORT_ID,
              status: 'OPEN',
              category: 'HARASSMENT',
              severity: 'MEDIUM',
              urgent: false,
              dueAt: null,
              createdAt: '2026-11-24T10:00:00.000Z',
            },
          };
        }
        return { status: 200, body: {} };
      }),
    });

    let uploadAttempts = 0;
    client.upload = jest.fn(async () => {
      uploadAttempts++;
      if (uploadAttempts === 1) {
        return { key: 'key-photo-1', uploadId: 'u-1' };
      }
      if (uploadAttempts === 2) {
        throw new Error('Upload error for photo 2');
      }
      if (uploadAttempts === 3) {
        throw new Error('Upload error for photo 3');
      }
      return { key: 'key-photo-2-retried', uploadId: 'u-2' };
    });

    const screen = await renderWithProviders(<ReportScreen reportedUserId={PEER_USER_ID} />, { client });

    await fireEvent.press(screen.getByTestId('report-category-HARASSMENT'));

    // Thêm photo 1 -> thành công
    await fireEvent.press(screen.getByTestId('report-add-evidence'));
    await waitFor(() => {
      expect(screen.getByTestId('report-remove-evidence-0')).toBeTruthy();
    });

    // Thêm photo 2 -> lỗi
    await fireEvent.press(screen.getByTestId('report-add-evidence'));
    await waitFor(() => {
      expect(screen.getByTestId('report-retry-evidence-1')).toBeTruthy();
    });

    // Thêm photo 3 -> lỗi
    await fireEvent.press(screen.getByTestId('report-add-evidence'));
    await waitFor(() => {
      expect(screen.getByTestId('report-retry-evidence-2')).toBeTruthy();
    });

    // Thử lại photo 2 -> thành công
    await fireEvent.press(screen.getByTestId('report-retry-evidence-1'));
    await waitFor(() => {
      expect(screen.queryByTestId('report-retry-evidence-1')).toBeNull();
    });

    // Submit báo cáo (photo 3 vẫn ở trạng thái lỗi)
    expect(screen.getByText(REPORT_COPY.evidenceSection.failedNotice)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('report-submit').props.accessibilityState.disabled).toBe(false);
    });
    await fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('report-confirm')).toBeTruthy();
    });
    await fireEvent.press(screen.getByTestId('report-confirm-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('report-sent')).toBeTruthy();
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody?.['evidenceKeys']).toEqual(['key-photo-1', 'key-photo-2-retried']);

    await screen.unmount();
  });

  // f. lỗi REPORT_TARGET_INVALID → toast đúng title, form giữ nguyên.
  it('f. shows toast with correct error title on REPORT_TARGET_INVALID and preserves form data', async () => {
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url, init) => {
        if (url.includes('/me/reports') && init?.method === 'POST') {
          return {
            status: 422,
            body: createProblemBody({ code: 'REPORT_TARGET_INVALID', status: 422 }),
          };
        }
        return { status: 200, body: {} };
      }),
    });

    const screen = await renderWithProviders(<ReportScreen reportedUserId={PEER_USER_ID} />, { client });

    await fireEvent.press(screen.getByTestId('report-category-NO_SHOW_DISRESPECT'));
    const descInput = screen.getByTestId('report-description');
    await fireEvent.changeText(descInput, 'Nội dung phản ánh được giữ nguyên');

    await fireEvent.press(screen.getByTestId('report-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('report-confirm')).toBeTruthy();
    });
    await fireEvent.press(screen.getByTestId('report-confirm-submit'));

    // Chờ toast xuất hiện với title của REPORT_TARGET_INVALID
    await waitFor(() => {
      expect(screen.getByText(messageFor({ code: 'REPORT_TARGET_INVALID' }).title)).toBeTruthy();
    });

    // Form vẫn giữ nguyên, không biến mất hay chuyển sang report-sent
    expect(screen.queryByTestId('report-sent')).toBeNull();
    expect(screen.getByTestId('report-description').props.value).toBe('Nội dung phản ánh được giữ nguyên');

    await screen.unmount();
  });

  it('f2. từ chối quyền ảnh → toast hướng dẫn, không thêm ảnh', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied' });
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch(() => ({ status: 200, body: { match: null } })),
    });
    const screen = await renderWithProviders(<ReportScreen reportedUserId={PEER_USER_ID} />, { client });

    await fireEvent.press(screen.getByTestId('report-add-evidence'));

    await waitFor(() => {
      expect(screen.getByText(REPORT_COPY.errors.photoAccess)).toBeTruthy();
    });
    expect(screen.queryByTestId('report-remove-evidence-0')).toBeNull();
    await screen.unmount();
  });

  // g. upload gọi purpose 'report_evidence'; file tạm bị xoá.
  it('g. calls upload with purpose report_evidence and deletes temporary manipulated file', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/ImagePicker/photo-raw.jpg', width: 1200, height: 800 }],
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch(() => ({ status: 200, body: {} })),
    });

    client.upload = jest.fn(async () => ({
      key: 'evidence-key-g',
      uploadId: 'upload-g',
    }));

    const screen = await renderWithProviders(<ReportScreen reportedUserId={PEER_USER_ID} />, { client });

    await fireEvent.press(screen.getByTestId('report-add-evidence'));

    await waitFor(() => {
      expect(client.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'report_evidence',
          contentType: 'image/jpeg',
        }),
      );
    });

    await waitFor(() => {
      expect(mockDeleteTempPhoto).toHaveBeenCalledWith(
        'file:///cache/ImagePicker/photo-raw.jpg-manipulated.jpg',
      );
    });

    // F5: rời màn thì xoá cả bản sao của image-picker.
    await screen.unmount();
    expect(mockDeleteTempPhoto).toHaveBeenCalledWith('file:///cache/ImagePicker/photo-raw.jpg');
  });

  // h. AC1 (tích hợp): chung queryClient (gcTime Infinity, retry false) + fake ChatClient; server LUÔN trả hội thoại OPEN: render ChatScreen có chat-input → unmount → render ReportScreen gửi thành công → render lại ChatScreen → `chat-readonly`, không có chat-input.
  it('h. AC1 integrated: marks peer reported so ChatScreen becomes readonly immediately despite server returning OPEN', async () => {
    const sharedQueryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: Infinity, retry: false },
        mutations: { gcTime: Infinity, retry: false },
      },
    });

    const fakeChatClient = createFakeChatClient('ready');

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url, init) => {
        if (url.includes(`/me/conversations/${CONVERSATION_ID}/messages`)) {
          return { status: 200, body: { items: [], hasMore: false } };
        }
        if (url.includes(`/me/conversations/${CONVERSATION_ID}/icebreakers`)) {
          return {
            status: 200,
            body: {
              conversationId: CONVERSATION_ID,
              datingDay: 4,
              datingDays: 14,
              theme: 'Phá băng',
              topics: [],
            },
          };
        }
        if (url.includes('/me/conversations')) {
          // Server LUÔN trả hội thoại OPEN
          return { status: 200, body: { items: [DEFAULT_SUMMARY] } };
        }
        if (url.includes('/me/match')) {
          return { status: 200, body: { match: DEFAULT_MATCH } };
        }
        if (url.includes('/me/reports') && init?.method === 'POST') {
          return {
            status: 201,
            body: {
              reportId: REPORT_ID,
              status: 'OPEN',
              category: 'HARASSMENT',
              severity: 'HIGH',
              urgent: false,
              dueAt: null,
              createdAt: '2026-11-24T10:00:00.000Z',
            },
          };
        }
        return { status: 200, body: {} };
      }),
    });

    // 1. Render ChatScreen: server trả OPEN -> chat-input có mặt, không có chat-readonly
    const chatScreen1 = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient: sharedQueryClient },
    );

    await waitFor(() => {
      expect(chatScreen1.getByTestId('chat-input')).toBeTruthy();
      expect(chatScreen1.queryByTestId('chat-readonly')).toBeNull();
    });

    const reportBtn = chatScreen1.getByTestId('chat-report');
    expect(reportBtn).toBeTruthy();

    await chatScreen1.unmount();

    // 2. Render ReportScreen với cùng queryClient -> gửi báo cáo thành công
    const reportScreen = await renderWithProviders(<ReportScreen reportedUserId={PEER_USER_ID} />, {
      client,
      queryClient: sharedQueryClient,
    });

    await fireEvent.press(reportScreen.getByTestId('report-category-HARASSMENT'));
    await fireEvent.press(reportScreen.getByTestId('report-submit'));
    await waitFor(() => {
      expect(reportScreen.getByTestId('report-confirm')).toBeTruthy();
    });
    await fireEvent.press(reportScreen.getByTestId('report-confirm-submit'));

    await waitFor(() => {
      expect(reportScreen.getByTestId('report-sent')).toBeTruthy();
    });

    await reportScreen.unmount();

    // 3. Render lại ChatScreen với cùng queryClient: server vẫn trả OPEN nhưng chat đã chuyển sang chỉ đọc
    const chatScreen2 = await renderWithProviders(
      <ChatClientProvider client={fakeChatClient}>
        <ChatScreen conversationId={CONVERSATION_ID} />
      </ChatClientProvider>,
      { client, queryClient: sharedQueryClient },
    );

    await waitFor(() => {
      expect(chatScreen2.getByTestId('chat-readonly')).toBeTruthy();
      expect(chatScreen2.queryByTestId('chat-input')).toBeNull();
    });

    await chatScreen2.unmount();
  });

  // i. không có /hotline|số điện thoại|Mai Hương|100%|pháp lý/i.
  it('i. does not contain any forbidden terms in copy strings or rendered screens', async () => {
    const forbiddenRegex = /hotline|số điện thoại|Mai Hương|100%|pháp lý/i;

    function checkObjectValues(obj: unknown, path = ''): void {
      if (typeof obj === 'string') {
        expect(obj).not.toMatch(forbiddenRegex);
      } else if (typeof obj === 'object' && obj !== null) {
        for (const [key, val] of Object.entries(obj)) {
          checkObjectValues(val, `${path}.${key}`);
        }
      }
    }

    checkObjectValues(REPORT_CATEGORIES_COPY);
    checkObjectValues(SAFETY_CENTER_COPY);
    checkObjectValues(REPORT_COPY);

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes('/me/match')) return { status: 200, body: { match: DEFAULT_MATCH } };
        return { status: 200, body: {} };
      }),
    });

    const reportScreen = await renderWithProviders(<ReportScreen reportedUserId={PEER_USER_ID} />, {
      client,
    });

    expect(reportScreen.queryByText(forbiddenRegex)).toBeNull();
    await reportScreen.unmount();

    const safetyScreen = await renderWithProviders(<SafetyCenterScreen />, { client });
    expect(safetyScreen.queryByText(forbiddenRegex)).toBeNull();
    await safetyScreen.unmount();
  });

  // j. SafetyCenter: có/không counterpart; push REPORT_UPDATED → safety-report-updated.
  it('j. SafetyCenter handles counterpart presence/absence and updates on push REPORT_UPDATED', async () => {
    // 1. Có counterpart: hiện nút 'Báo cáo {tên}'
    const clientWithCounterpart = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes('/me/match')) return { status: 200, body: { match: DEFAULT_MATCH } };
        return { status: 200, body: {} };
      }),
    });

    const screenWith = await renderWithProviders(<SafetyCenterScreen />, {
      client: clientWithCounterpart,
    });

    const reportPeerBtn = await screenWith.findByTestId('safety-report-counterpart-btn');
    expect(
      screenWith.getByText(SAFETY_CENTER_COPY.action.reportButton(DEFAULT_MATCH.counterpart!.displayName)),
    ).toBeTruthy();

    await fireEvent.press(reportPeerBtn);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(main)/safety/report',
      params: { reportedUserId: PEER_USER_ID },
    });

    await screenWith.unmount();

    // 2. Không có counterpart: hiện hướng dẫn, không hiện nút báo cáo đối phương
    const clientWithoutCounterpart = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes('/me/match')) return { status: 200, body: { match: null } };
        return { status: 200, body: {} };
      }),
    });

    const screenWithout = await renderWithProviders(<SafetyCenterScreen />, {
      client: clientWithoutCounterpart,
    });

    expect(screenWithout.queryByTestId('safety-report-counterpart-btn')).toBeNull();
    expect(screenWithout.getByText(SAFETY_CENTER_COPY.action.noMatchTitle)).toBeTruthy();
    expect(screenWithout.getByText(SAFETY_CENTER_COPY.action.noMatchDescription)).toBeTruthy();

    await screenWithout.unmount();

    // 3. Push REPORT_UPDATED khi đang mở màn -> hiện thông báo safety-report-updated
    const screenPush = await renderWithProviders(<SafetyCenterScreen />, {
      client: clientWithCounterpart,
    });

    expect(screenPush.queryByTestId('safety-report-updated')).toBeNull();

    await act(async () => {
      for (const listener of mockReceivedListeners) {
        listener({
          request: {
            content: {
              data: {
                kind: 'REPORT_UPDATED',
                reportId: REPORT_ID,
              },
            },
          },
        });
      }
    });

    await waitFor(() => {
      expect(screenPush.getByTestId('safety-report-updated')).toBeTruthy();
    });

    expect(screenPush.getByText(SAFETY_CENTER_COPY.notification.reportUpdated)).toBeTruthy();

    await screenPush.unmount();
  });
});
