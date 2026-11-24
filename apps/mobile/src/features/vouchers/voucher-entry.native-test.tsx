import { createApiClient, createMemoryTokenStore } from '@tamgiao/api-client';
import type { MyVouchersResponse } from '@tamgiao/contracts/billing';
import type { DatePlanDto } from '@tamgiao/contracts/dating';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import type { DateView } from '../dates/date-view.js';
import { VOUCHERS_COPY } from './copy.js';
import { VoucherEntry } from './voucher-entry.js';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const SAMPLE_PLAN: DatePlanDto = {
  id: '01890a5d-ac96-774b-bcce-b302099a8001',
  matchId: '01890a5d-ac96-774b-bcce-b302099a8002',
  inviterId: '01890a5d-ac96-774b-bcce-b302099a8003',
  inviteeId: '01890a5d-ac96-774b-bcce-b302099a8004',
  myRole: 'INVITER',
  partnerId: '01890a5d-ac96-774b-bcce-b302099a8005',
  startsAt: '2026-11-25T09:00:00.000Z',
  endsAt: '2026-11-25T11:00:00.000Z',
  staffBookingRequested: true,
  status: 'CONFIRMED',
  expiresAt: '2026-11-24T09:00:00.000Z',
  proposedAt: '2026-11-23T09:00:00.000Z',
  respondedAt: '2026-11-23T15:00:00.000Z',
  cancelledAt: null,
  cancelledBy: null,
  cancelDeadline: '2026-11-25T05:00:00.000Z',
};

const CONFIRMED_VIEW: DateView = {
  kind: 'confirmed',
  canRespond: false,
  canCancel: true,
  cancelLocked: false,
  canProposeNew: false,
};

const IN_PROGRESS_VIEW: DateView = {
  kind: 'in_progress',
  canRespond: false,
  canCancel: false,
  cancelLocked: false,
  canProposeNew: false,
};

const PROPOSED_VIEW: DateView = {
  kind: 'proposed_inviter',
  canRespond: false,
  canCancel: false,
  cancelLocked: false,
  canProposeNew: false,
};

describe('VoucherEntry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hiển thị nút Voucher của bạn khi view là confirmed, vai trò là INVITER và có voucher ACTIVE', async () => {
    const vouchersResponse: MyVouchersResponse = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8010',
          status: 'ACTIVE',
          valueVnd: 300_000,
          expiresAt: '2026-12-31T00:00:00.000Z',
          partnerId: null,
          issuedAt: '2026-11-01T00:00:00.000Z',
          activatedAt: '2026-11-02T00:00:00.000Z',
          redeemedAt: null,
        },
      ],
    };

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes('/me/vouchers')) {
          return { status: 200, body: vouchersResponse };
        }
        return { status: 404, body: {} };
      }),
    });

    const screen = await renderWithProviders(<VoucherEntry plan={SAMPLE_PLAN} view={CONFIRMED_VIEW} />, {
      client,
      queryClient: createTestQueryClient(),
    });

    const button = await screen.findByTestId('date-voucher');
    expect(button).toBeTruthy();
    expect(screen.getByText(VOUCHERS_COPY.actions.entryButton)).toBeTruthy();

    await waitFor(() => {
      expect(button.props.accessibilityState?.disabled ?? false).toBe(false);
    });

    await fireEvent.press(button);
    expect(mockPush).toHaveBeenCalledWith('/(main)/vouchers');

    await screen.unmount();
  });

  it('hiển thị nút khi view là in_progress', async () => {
    const vouchersResponse: MyVouchersResponse = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8010',
          status: 'ACTIVE',
          valueVnd: 300_000,
          expiresAt: '2026-12-31T00:00:00.000Z',
          partnerId: null,
          issuedAt: '2026-11-01T00:00:00.000Z',
          activatedAt: '2026-11-02T00:00:00.000Z',
          redeemedAt: null,
        },
      ],
    };

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch((url) => {
        if (url.includes('/me/vouchers')) {
          return { status: 200, body: vouchersResponse };
        }
        return { status: 404, body: {} };
      }),
    });

    const screen = await renderWithProviders(<VoucherEntry plan={SAMPLE_PLAN} view={IN_PROGRESS_VIEW} />, {
      client,
      queryClient: createTestQueryClient(),
    });

    const button = await screen.findByTestId('date-voucher');
    expect(button).toBeTruthy();

    await screen.unmount();
  });

  it('ẩn nút khi người xem là INVITEE (người được mời)', async () => {
    const inviteePlan: DatePlanDto = {
      ...SAMPLE_PLAN,
      myRole: 'INVITEE',
    };

    const vouchersResponse: MyVouchersResponse = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8010',
          status: 'ACTIVE',
          valueVnd: 300_000,
          expiresAt: '2026-12-31T00:00:00.000Z',
          partnerId: null,
          issuedAt: '2026-11-01T00:00:00.000Z',
          activatedAt: '2026-11-02T00:00:00.000Z',
          redeemedAt: null,
        },
      ],
    };

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch(() => ({ status: 200, body: vouchersResponse })),
    });

    const screen = await renderWithProviders(<VoucherEntry plan={inviteePlan} view={CONFIRMED_VIEW} />, {
      client,
      queryClient: createTestQueryClient(),
    });

    // Chờ GET /me/vouchers xong rồi mới khẳng định không có nút.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 30));
    });
    expect(screen.queryByTestId('date-voucher')).toBeNull();

    await screen.unmount();
  });

  it('ẩn nút khi lịch ở trạng thái khác (vd proposed_inviter)', async () => {
    const vouchersResponse: MyVouchersResponse = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8010',
          status: 'ACTIVE',
          valueVnd: 300_000,
          expiresAt: '2026-12-31T00:00:00.000Z',
          partnerId: null,
          issuedAt: '2026-11-01T00:00:00.000Z',
          activatedAt: '2026-11-02T00:00:00.000Z',
          redeemedAt: null,
        },
      ],
    };

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch(() => ({ status: 200, body: vouchersResponse })),
    });

    const screen = await renderWithProviders(<VoucherEntry plan={SAMPLE_PLAN} view={PROPOSED_VIEW} />, {
      client,
      queryClient: createTestQueryClient(),
    });

    // Chờ GET /me/vouchers xong rồi mới khẳng định không có nút.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 30));
    });
    expect(screen.queryByTestId('date-voucher')).toBeNull();

    await screen.unmount();
  });

  it('ẩn nút khi không có voucher ACTIVE (chỉ có RESERVED)', async () => {
    const vouchersResponse: MyVouchersResponse = {
      items: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8010',
          status: 'RESERVED',
          valueVnd: 300_000,
          expiresAt: null,
          partnerId: null,
          issuedAt: '2026-11-01T00:00:00.000Z',
          activatedAt: null,
          redeemedAt: null,
        },
      ],
    };

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: createFakeFetch(() => ({ status: 200, body: vouchersResponse })),
    });

    const screen = await renderWithProviders(<VoucherEntry plan={SAMPLE_PLAN} view={CONFIRMED_VIEW} />, {
      client,
      queryClient: createTestQueryClient(),
    });

    // Chờ GET /me/vouchers xong rồi mới khẳng định không có nút.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 30));
    });
    expect(screen.queryByTestId('date-voucher')).toBeNull();

    await screen.unmount();
  });
});
