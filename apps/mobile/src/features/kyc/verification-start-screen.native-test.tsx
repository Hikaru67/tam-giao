import { createApiClient, createMemoryTokenStore } from '@tamgiao/api-client';
import type { VerificationPaymentStatus } from '@tamgiao/contracts/billing';
import { waitFor } from '@testing-library/react-native';
import {
  createFakeFetch,
  createTestQueryClient,
  renderWithProviders,
} from '../../test-utils/render-with-providers.js';
import type { KycProgressStatus } from './types.js';
import { resolveVerificationEntry, VERIFICATION_ROUTES } from './verification-entry.js';
import { VerificationStartScreen } from './verification-start-screen.js';

const mockRedirect = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({}),
  Redirect: (props: { href: string }) => {
    mockRedirect(props.href);
    return null;
  },
}));

describe('resolveVerificationEntry (bảng quyết định điều hướng)', () => {
  const cases: [KycProgressStatus, VerificationPaymentStatus | null, string][] = [
    ['NOT_SUBMITTED', null, VERIFICATION_ROUTES.payment],
    ['NOT_SUBMITTED', 'PENDING', VERIFICATION_ROUTES.payment],
    ['NOT_SUBMITTED', 'FAILED', VERIFICATION_ROUTES.payment],
    ['DRAFT', 'SUCCEEDED', VERIFICATION_ROUTES.kyc],
    ['NEEDS_MORE_INFO', null, VERIFICATION_ROUTES.kyc],
    ['UNDER_REVIEW', 'SUCCEEDED', VERIFICATION_ROUTES.status],
    ['APPROVED', 'SUCCEEDED', VERIFICATION_ROUTES.status],
    ['REJECTED', 'REFUNDED', VERIFICATION_ROUTES.status],
  ];

  it.each(cases)('kycStatus=%s, paymentStatus=%s → %s', (kycStatus, paymentStatus, expectedRoute) => {
    expect(resolveVerificationEntry(kycStatus, paymentStatus)).toBe(expectedRoute);
  });
});

describe('VerificationStartScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('kyc NOT_SUBMITTED + payment SUCCEEDED → redirect sang /(verification)/kyc', async () => {
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/kyc') {
        return {
          status: 200,
          body: {
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
      if (url === 'http://api.test/me/payments') {
        return {
          status: 200,
          body: {
            items: [
              {
                paymentId: '01952e46-953b-789a-b283-a9d701897d26',
                orderId: 'ORD-1',
                status: 'SUCCEEDED',
                amountVnd: 299000,
                checkoutUrl: null,
                qrData: null,
                createdAt: '2026-11-22T00:00:00.000Z',
                succeededAt: '2026-11-22T00:01:00.000Z',
                failedAt: null,
                refundedAt: null,
              },
            ],
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<VerificationStartScreen />, { client, queryClient });

    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith(VERIFICATION_ROUTES.kyc);
    });

    await screen.unmount();
  });

  it('NOT_SUBMITTED + chưa thanh toán (items []) → redirect sang /(verification)/payment', async () => {
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/kyc') {
        return {
          status: 200,
          body: {
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
      if (url === 'http://api.test/me/payments') {
        return {
          status: 200,
          body: { items: [] },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<VerificationStartScreen />, { client, queryClient });

    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith(VERIFICATION_ROUTES.payment);
    });

    await screen.unmount();
  });

  it('SUBMITTED → redirect sang /(verification)/status', async () => {
    const fakeFetch = createFakeFetch((url) => {
      if (url === 'http://api.test/me/kyc') {
        return {
          status: 200,
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
      if (url === 'http://api.test/me/payments') {
        return {
          status: 200,
          body: {
            items: [
              {
                paymentId: '01952e46-953b-789a-b283-a9d701897d26',
                orderId: 'ORD-1',
                status: 'SUCCEEDED',
                amountVnd: 299000,
                checkoutUrl: null,
                qrData: null,
                createdAt: '2026-11-22T00:00:00.000Z',
                succeededAt: '2026-11-22T00:01:00.000Z',
                failedAt: null,
                refundedAt: null,
              },
            ],
          },
        };
      }
      return { status: 404 };
    });

    const client = createApiClient({
      baseUrl: 'http://api.test',
      tokenStore: createMemoryTokenStore(),
      fetch: fakeFetch,
    });
    const queryClient = createTestQueryClient();

    const screen = await renderWithProviders(<VerificationStartScreen />, { client, queryClient });

    await waitFor(() => {
      expect(mockRedirect).toHaveBeenCalledWith(VERIFICATION_ROUTES.status);
    });

    await screen.unmount();
  });
});
