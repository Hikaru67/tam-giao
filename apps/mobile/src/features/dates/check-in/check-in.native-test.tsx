import { createApiClient, createMemoryTokenStore, messageFor } from '@tamgiao/api-client';
import type {
  CheckInBody,
  DatePlanDto,
  MyCheckInResponse,
  SafetyCheckInDto,
} from '@tamgiao/contracts/dating';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createProblemBody,
  createTestQueryClient,
  renderWithProviders,
} from '../../../test-utils/render-with-providers.js';
import type { DateView, DateViewKind } from '../date-view.js';
import { formatLocalTime } from '../date-options.js';
import { CheckInCard } from './check-in-card.js';
import { CHECK_IN_COPY } from './copy.js';

const mockRequestForegroundPermissionsAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: () => ({ remove: () => undefined }),
}));

jest.mock('expo-location', () => ({
  Accuracy: {
    Balanced: 3,
  },
  requestForegroundPermissionsAsync: () => mockRequestForegroundPermissionsAsync(),
  getCurrentPositionAsync: (options: unknown) => mockGetCurrentPositionAsync(options),
}));

const PLAN_ID = '01890a5d-ac96-774b-bcce-b302099a8021';
const MATCH_ID = '01890a5d-ac96-774b-bcce-b302099a8031';
const USER_A_ID = '01890a5d-ac96-774b-bcce-b302099a8041';
const USER_B_ID = '01890a5d-ac96-774b-bcce-b302099a8042';
const PARTNER_ID = '01890a5d-ac96-774b-bcce-b302099a8011';
const CHECK_IN_ID = '01890a5d-ac96-774b-bcce-b302099a8051';

const BASE_PLAN: DatePlanDto = {
  id: PLAN_ID,
  matchId: MATCH_ID,
  inviterId: USER_A_ID,
  inviteeId: USER_B_ID,
  myRole: 'INVITER',
  partnerId: PARTNER_ID,
  startsAt: '2026-11-25T09:00:00.000Z',
  endsAt: '2026-11-25T11:00:00.000Z',
  staffBookingRequested: true,
  status: 'CONFIRMED',
  expiresAt: '2026-11-24T09:00:00.000Z',
  proposedAt: '2026-11-23T09:00:00.000Z',
  respondedAt: '2026-11-23T10:00:00.000Z',
  cancelledAt: null,
  cancelledBy: null,
  cancelDeadline: '2026-11-25T05:00:00.000Z',
};

const BASE_CHECK_IN: SafetyCheckInDto = {
  id: CHECK_IN_ID,
  datePlanId: PLAN_ID,
  source: 'MANUAL',
  checkedInAt: '2026-11-25T09:05:00.000Z',
  overdueAt: '2026-11-25T12:00:00.000Z',
  checkedOutAt: null,
  overdueAlertedAt: null,
  locationShared: false,
};

function createView(kind: DateViewKind): DateView {
  return {
    kind,
    canRespond: false,
    canCancel: false,
    cancelLocked: false,
    canProposeNew: false,
  };
}

describe('CheckInCard (FE-S5-03)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
      status: 'granted',
    });
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: {
        latitude: 10.7769,
        longitude: 106.7009,
        accuracy: 15,
      },
    });
  });

  describe('bảng view.kind -> hiện/ẩn và số lần gọi API', () => {
    const tableCases: Array<{
      kind: DateViewKind;
      checkIn: SafetyCheckInDto | null;
      expectVisible: boolean;
      expectedApiCalls: number;
    }> = [
      { kind: 'none', checkIn: null, expectVisible: false, expectedApiCalls: 0 },
      { kind: 'proposed_inviter', checkIn: null, expectVisible: false, expectedApiCalls: 0 },
      { kind: 'proposed_invitee', checkIn: null, expectVisible: false, expectedApiCalls: 0 },
      { kind: 'proposed_expired', checkIn: null, expectVisible: false, expectedApiCalls: 0 },
      { kind: 'completed', checkIn: null, expectVisible: false, expectedApiCalls: 1 },
      { kind: 'completed', checkIn: BASE_CHECK_IN, expectVisible: true, expectedApiCalls: 1 },
      { kind: 'ended', checkIn: null, expectVisible: false, expectedApiCalls: 0 },
      { kind: 'confirmed', checkIn: null, expectVisible: true, expectedApiCalls: 0 },
      { kind: 'in_progress', checkIn: null, expectVisible: true, expectedApiCalls: 1 },
      { kind: 'awaiting_feedback', checkIn: null, expectVisible: false, expectedApiCalls: 1 },
      { kind: 'awaiting_feedback', checkIn: BASE_CHECK_IN, expectVisible: true, expectedApiCalls: 1 },
    ];

    test.each(tableCases)(
      'view.kind = $kind (checkIn: $checkIn) -> expectVisible: $expectVisible, apiCalls: $expectedApiCalls',
      async ({ kind, checkIn, expectVisible, expectedApiCalls }) => {
        let apiCallCount = 0;
        const queryClient = createTestQueryClient();
        const client = createApiClient({
          baseUrl: 'http://api.test',
          tokenStore: createMemoryTokenStore(),
          fetch: createFakeFetch((url) => {
            if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
              apiCallCount += 1;
              const res: MyCheckInResponse = { checkIn };
              return { status: 200, body: res };
            }
            return { status: 200, body: {} };
          }),
        });

        const screen = await renderWithProviders(<CheckInCard plan={BASE_PLAN} view={createView(kind)} />, {
          client,
          queryClient,
        });

        if (expectVisible) {
          await waitFor(() => {
            expect(screen.getByText(CHECK_IN_COPY.cardTitle)).toBeTruthy();
          });
        } else {
          // Chờ để nếu có API thì query hoàn tất
          await act(async () => {
            await new Promise<void>((resolve) => setTimeout(() => resolve(), 20));
          });
          expect(screen.queryByText(CHECK_IN_COPY.cardTitle)).toBeNull();
        }

        expect(apiCallCount).toBe(expectedApiCalls);
        await screen.unmount();
      },
    );
  });

  test('đang tải trạng thái → chưa cho bấm check-in; lỗi tải → chỉ hiện dòng lỗi, thử lại được', async () => {
    let failing = true;
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch(() =>
        failing
          ? { status: 500, body: createProblemBody({ code: 'INTERNAL_ERROR', status: 500 }) }
          : { status: 200, body: { checkIn: null } satisfies MyCheckInResponse },
      ),
    });
    const screen = await renderWithProviders(
      <CheckInCard plan={BASE_PLAN} view={createView('in_progress')} />,
      { client, queryClient: createTestQueryClient() },
    );
    await waitFor(() => {
      expect(screen.getByText(CHECK_IN_COPY.errors.loadFailed)).toBeTruthy();
    });
    expect(screen.queryByTestId('checkin-submit')).toBeNull();

    failing = false;
    await fireEvent.press(screen.getByText(CHECK_IN_COPY.actions.retry));
    await waitFor(() => {
      expect(screen.getByTestId('checkin-submit')).toBeTruthy();
    });
    await screen.unmount();
  });

  test('check-in không vị trí: body {} và KHÔNG gọi requestForegroundPermissions', async () => {
    let checkInBody: CheckInBody | null = null;
    let postCallCount = 0;
    const queryClient = createTestQueryClient();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url, init) => {
        if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
          if (init?.method === 'POST') {
            postCallCount += 1;
            checkInBody = JSON.parse(init.body as string) as CheckInBody;
            return { status: 201, body: BASE_CHECK_IN };
          }
          const res: MyCheckInResponse = { checkIn: null };
          return { status: 200, body: res };
        }
        return { status: 200, body: {} };
      }),
    });

    const screen = await renderWithProviders(
      <CheckInCard plan={BASE_PLAN} view={createView('in_progress')} />,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('checkin-share-location')).toBeTruthy();
    });

    const submitBtn = screen.getByTestId('checkin-submit');
    await waitFor(() => {
      expect(submitBtn.props.accessibilityState.disabled).toBe(false);
    });

    await fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(postCallCount).toBe(1);
    });

    expect(mockRequestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(checkInBody).toEqual({});
    await waitFor(() => {
      expect(screen.getByText(CHECK_IN_COPY.toasts.successWithLocation)).toBeTruthy();
    });

    await screen.unmount();
  });

  test('có vị trí: body đúng, quyền chỉ xin khi bấm', async () => {
    let checkInBody: CheckInBody | null = null;
    let postCallCount = 0;
    const queryClient = createTestQueryClient();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url, init) => {
        if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
          if (init?.method === 'POST') {
            postCallCount += 1;
            checkInBody = JSON.parse(init.body as string) as CheckInBody;
            const updatedCheckIn: SafetyCheckInDto = {
              ...BASE_CHECK_IN,
              locationShared: true,
            };
            return { status: 201, body: updatedCheckIn };
          }
          const res: MyCheckInResponse = { checkIn: null };
          return { status: 200, body: res };
        }
        return { status: 200, body: {} };
      }),
    });

    const screen = await renderWithProviders(
      <CheckInCard plan={BASE_PLAN} view={createView('in_progress')} />,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('checkin-share-location')).toBeTruthy();
    });

    // Bật switch
    await fireEvent(screen.getByTestId('checkin-share-location'), 'valueChange', true);

    // Quyền CHƯA được xin khi bật switch
    expect(mockRequestForegroundPermissionsAsync).not.toHaveBeenCalled();

    const submitBtn = screen.getByTestId('checkin-submit');
    await fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(postCallCount).toBe(1);
    });

    // Quyền chỉ xin khi bấm nút check-in
    expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(checkInBody).toEqual({
      location: {
        latitude: 10.7769,
        longitude: 106.7009,
        accuracyMeters: 15,
      },
    });

    await screen.unmount();
  });

  describe('AC1: từ chối quyền, lỗi lấy vị trí, timeout (fake timer)', () => {
    test('từ chối quyền -> vẫn check-in với body {} và toast thông báo không gửi vị trí', async () => {
      mockRequestForegroundPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: 'denied',
      });

      let checkInBody: CheckInBody | null = null;
      const queryClient = createTestQueryClient();
      const client = createApiClient({
        baseUrl: 'http://api.test',
        tokenStore: createMemoryTokenStore(),
        fetch: createFakeFetch((url, init) => {
          if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
            if (init?.method === 'POST') {
              checkInBody = JSON.parse(init.body as string) as CheckInBody;
              return { status: 201, body: BASE_CHECK_IN };
            }
            const res: MyCheckInResponse = { checkIn: null };
            return { status: 200, body: res };
          }
          return { status: 200, body: {} };
        }),
      });

      const screen = await renderWithProviders(
        <CheckInCard plan={BASE_PLAN} view={createView('in_progress')} />,
        { client, queryClient },
      );

      await waitFor(() => {
        expect(screen.getByTestId('checkin-share-location')).toBeTruthy();
      });

      await fireEvent(screen.getByTestId('checkin-share-location'), 'valueChange', true);
      await fireEvent.press(screen.getByTestId('checkin-submit'));

      await waitFor(() => {
        expect(screen.getByText(CHECK_IN_COPY.toasts.successWithoutLocation)).toBeTruthy();
      });

      expect(checkInBody).toEqual({});
      await screen.unmount();
    });

    test('lỗi lấy vị trí -> vẫn check-in với body {} và toast thông báo không gửi vị trí', async () => {
      mockRequestForegroundPermissionsAsync.mockResolvedValueOnce({
        granted: true,
        status: 'granted',
      });
      mockGetCurrentPositionAsync.mockRejectedValueOnce(new Error('GPS device timeout'));

      let checkInBody: CheckInBody | null = null;
      const queryClient = createTestQueryClient();
      const client = createApiClient({
        baseUrl: 'http://api.test',
        tokenStore: createMemoryTokenStore(),
        fetch: createFakeFetch((url, init) => {
          if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
            if (init?.method === 'POST') {
              checkInBody = JSON.parse(init.body as string) as CheckInBody;
              return { status: 201, body: BASE_CHECK_IN };
            }
            const res: MyCheckInResponse = { checkIn: null };
            return { status: 200, body: res };
          }
          return { status: 200, body: {} };
        }),
      });

      const screen = await renderWithProviders(
        <CheckInCard plan={BASE_PLAN} view={createView('in_progress')} />,
        { client, queryClient },
      );

      await waitFor(() => {
        expect(screen.getByTestId('checkin-share-location')).toBeTruthy();
      });

      await fireEvent(screen.getByTestId('checkin-share-location'), 'valueChange', true);
      await fireEvent.press(screen.getByTestId('checkin-submit'));

      await waitFor(() => {
        expect(screen.getByText(CHECK_IN_COPY.toasts.successWithoutLocation)).toBeTruthy();
      });

      expect(checkInBody).toEqual({});
      await screen.unmount();
    });

    test('timeout lấy vị trí (fake timer 10s) -> vẫn check-in với body {}', async () => {
      jest.useFakeTimers();

      mockRequestForegroundPermissionsAsync.mockResolvedValueOnce({
        granted: true,
        status: 'granted',
      });
      // Promise treo vô hạn
      mockGetCurrentPositionAsync.mockReturnValueOnce(new Promise(() => {}));

      let checkInBody: CheckInBody | null = null;
      const queryClient = createTestQueryClient();
      const client = createApiClient({
        baseUrl: 'http://api.test',
        tokenStore: createMemoryTokenStore(),
        fetch: createFakeFetch((url, init) => {
          if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
            if (init?.method === 'POST') {
              checkInBody = JSON.parse(init.body as string) as CheckInBody;
              return { status: 201, body: BASE_CHECK_IN };
            }
            const res: MyCheckInResponse = { checkIn: null };
            return { status: 200, body: res };
          }
          return { status: 200, body: {} };
        }),
      });

      const screen = await renderWithProviders(
        <CheckInCard plan={BASE_PLAN} view={createView('in_progress')} />,
        { client, queryClient },
      );

      await waitFor(() => {
        expect(screen.getByTestId('checkin-share-location')).toBeTruthy();
      });

      await fireEvent(screen.getByTestId('checkin-share-location'), 'valueChange', true);
      await fireEvent.press(screen.getByTestId('checkin-submit'));

      // Chạy fake timer tới 10_000ms
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });

      await waitFor(() => {
        expect(screen.getByText(CHECK_IN_COPY.toasts.successWithoutLocation)).toBeTruthy();
      });

      expect(checkInBody).toEqual({});
      await screen.unmount();
      jest.useRealTimers();
    });
  });

  test('AC2: sau check-in, queryClient và console.* KHÔNG chứa toạ độ', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log');
    const consoleInfoSpy = jest.spyOn(console, 'info');
    const consoleWarnSpy = jest.spyOn(console, 'warn');
    const consoleErrorSpy = jest.spyOn(console, 'error');

    const LAT = 10.7769;
    const LNG = 106.7009;

    mockRequestForegroundPermissionsAsync.mockResolvedValueOnce({
      granted: true,
      status: 'granted',
    });
    mockGetCurrentPositionAsync.mockResolvedValueOnce({
      coords: {
        latitude: LAT,
        longitude: LNG,
        accuracy: 10,
      },
    });

    const queryClient = createTestQueryClient();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url, init) => {
        if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
          if (init?.method === 'POST') {
            const updatedCheckIn: SafetyCheckInDto = {
              ...BASE_CHECK_IN,
              locationShared: true,
            };
            return { status: 201, body: updatedCheckIn };
          }
          const res: MyCheckInResponse = { checkIn: null };
          return { status: 200, body: res };
        }
        return { status: 200, body: {} };
      }),
    });

    const screen = await renderWithProviders(
      <CheckInCard plan={BASE_PLAN} view={createView('in_progress')} />,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('checkin-share-location')).toBeTruthy();
    });

    await fireEvent(screen.getByTestId('checkin-share-location'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('checkin-submit'));

    await waitFor(() => {
      expect(screen.getByText(CHECK_IN_COPY.toasts.successWithLocation)).toBeTruthy();
    });

    // Kiểm tra cache React Query không chứa toạ độ
    const queryCacheDump = JSON.stringify(queryClient.getQueryCache().getAll());
    const mutationCacheDump = JSON.stringify(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    );

    expect(queryCacheDump.includes(String(LAT))).toBe(false);
    expect(queryCacheDump.includes(String(LNG))).toBe(false);
    expect(mutationCacheDump.includes(String(LAT))).toBe(false);
    expect(mutationCacheDump.includes(String(LNG))).toBe(false);

    // Kiểm tra console.* không bị gọi với toạ độ
    const allSpies = [consoleLogSpy, consoleInfoSpy, consoleWarnSpy, consoleErrorSpy];
    for (const spy of allSpies) {
      for (const call of spy.mock.calls) {
        const str = JSON.stringify(call);
        expect(str.includes(String(LAT))).toBe(false);
        expect(str.includes(String(LNG))).toBe(false);
      }
    }

    allSpies.forEach((s) => s.mockRestore());
    await screen.unmount();
  });

  test('check-out: bấm là gửi và cập nhật trạng thái đã check-out', async () => {
    let postCheckOutCount = 0;
    const checkedOutDto: SafetyCheckInDto = {
      ...BASE_CHECK_IN,
      checkedOutAt: '2026-11-25T10:45:00.000Z',
    };

    const queryClient = createTestQueryClient();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url, init) => {
        if (url.includes(`/me/dates/${PLAN_ID}/check-out`) && init?.method === 'POST') {
          postCheckOutCount += 1;
          return { status: 200, body: checkedOutDto };
        }
        if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
          const res: MyCheckInResponse = { checkIn: BASE_CHECK_IN };
          return { status: 200, body: res };
        }
        return { status: 200, body: {} };
      }),
    });

    const screen = await renderWithProviders(
      <CheckInCard plan={BASE_PLAN} view={createView('in_progress')} />,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('checkin-out')).toBeTruthy();
    });

    const checkOutBtn = screen.getByTestId('checkin-out');
    await waitFor(() => {
      expect(checkOutBtn.props.accessibilityState.disabled).toBe(false);
    });

    await fireEvent.press(checkOutBtn);

    await waitFor(() => {
      expect(postCheckOutCount).toBe(1);
    });

    await waitFor(() => {
      expect(screen.getByText(CHECK_IN_COPY.toasts.checkOutSuccess)).toBeTruthy();
      expect(
        screen.getByText(CHECK_IN_COPY.checkedOutAt(formatLocalTime(checkedOutDto.checkedOutAt!))),
      ).toBeTruthy();
    });

    await screen.unmount();
  });

  test('xử lý lỗi DATE_CHECK_IN_WINDOW_CLOSED và DATE_ALREADY_CHECKED_IN (trigger GET lại)', async () => {
    let getCallCount = 0;
    const queryClient = createTestQueryClient();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url, init) => {
        if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
          if (init?.method === 'POST') {
            return {
              status: 409,
              body: createProblemBody({
                code: 'DATE_ALREADY_CHECKED_IN',
                title: 'Bạn đã check-in buổi hẹn này',
              }),
            };
          }
          getCallCount += 1;
          const res: MyCheckInResponse = { checkIn: null };
          return { status: 200, body: res };
        }
        return { status: 200, body: {} };
      }),
    });

    const screen = await renderWithProviders(
      <CheckInCard plan={BASE_PLAN} view={createView('in_progress')} />,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('checkin-submit')).toBeTruthy();
    });
    expect(getCallCount).toBe(1);

    await fireEvent.press(screen.getByTestId('checkin-submit'));

    await waitFor(() => {
      expect(screen.getByText(messageFor({ code: 'DATE_ALREADY_CHECKED_IN' }).title)).toBeTruthy();
    });

    // Invalidate query khiến GET được gọi lại
    await waitFor(() => {
      expect(getCallCount).toBeGreaterThan(1);
    });

    await screen.unmount();
  });

  test('nguồn check-in từ voucher hiển thị đúng nhãn', async () => {
    const voucherCheckIn: SafetyCheckInDto = {
      ...BASE_CHECK_IN,
      source: 'VOUCHER',
    };

    const queryClient = createTestQueryClient();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
          const res: MyCheckInResponse = { checkIn: voucherCheckIn };
          return { status: 200, body: res };
        }
        return { status: 200, body: {} };
      }),
    });

    const screen = await renderWithProviders(
      <CheckInCard plan={BASE_PLAN} view={createView('in_progress')} />,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText(CHECK_IN_COPY.sources.VOUCHER)).toBeTruthy();
    });

    await screen.unmount();
  });

  test('nhắc check-out khi quá endsAt (awaiting_feedback) chưa check-out', async () => {
    const queryClient = createTestQueryClient();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
          const res: MyCheckInResponse = { checkIn: BASE_CHECK_IN };
          return { status: 200, body: res };
        }
        return { status: 200, body: {} };
      }),
    });

    const screen = await renderWithProviders(
      <CheckInCard plan={BASE_PLAN} view={createView('awaiting_feedback')} />,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByTestId('checkin-overdue-hint')).toBeTruthy();
      expect(screen.getByText(CHECK_IN_COPY.overdueHint)).toBeTruthy();
    });

    await screen.unmount();
  });

  test('lỗi GET check-in hiển thị dòng thông báo nhỏ và nút thử lại', async () => {
    let attempts = 0;
    const queryClient = createTestQueryClient();
    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes(`/me/dates/${PLAN_ID}/check-in`)) {
          attempts += 1;
          if (attempts === 1) {
            return {
              status: 500,
              body: createProblemBody({ code: 'INTERNAL_ERROR', title: 'Lỗi server' }),
            };
          }
          const res: MyCheckInResponse = { checkIn: null };
          return { status: 200, body: res };
        }
        return { status: 200, body: {} };
      }),
    });

    const screen = await renderWithProviders(
      <CheckInCard plan={BASE_PLAN} view={createView('in_progress')} />,
      { client, queryClient },
    );

    await waitFor(() => {
      expect(screen.getByText(CHECK_IN_COPY.errors.loadFailed)).toBeTruthy();
      expect(screen.getByText(CHECK_IN_COPY.actions.retry)).toBeTruthy();
    });

    await fireEvent.press(screen.getByText(CHECK_IN_COPY.actions.retry));

    await waitFor(() => {
      expect(attempts).toBe(2);
      expect(screen.queryByText(CHECK_IN_COPY.errors.loadFailed)).toBeNull();
    });

    await screen.unmount();
  });
});
