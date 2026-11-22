import { act, renderHook } from '@testing-library/react-native';
import { notificationKindOf, useForegroundNotification } from './use-foreground-notification.js';

const mockRemove = jest.fn();
let mockListenerCb: ((n: unknown) => void) | null = null;
const mockAddReceived = jest.fn((cb: unknown) => {
  mockListenerCb = cb as (n: unknown) => void;
  return { remove: mockRemove };
});

jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
}));

describe('useForegroundNotification & notificationKindOf', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListenerCb = null;
  });

  describe('notificationKindOf', () => {
    it('Trả về null khi data là null, undefined, số, chuỗi, mảng, hoặc object không hợp lệ', () => {
      expect(notificationKindOf(null)).toBeNull();
      expect(notificationKindOf(undefined)).toBeNull();
      expect(notificationKindOf(123)).toBeNull();
      expect(notificationKindOf('KYC_APPROVED')).toBeNull();
      expect(notificationKindOf([])).toBeNull();
      expect(notificationKindOf({})).toBeNull();
      expect(notificationKindOf({ kind: 'UNKNOWN_KIND' })).toBeNull();
    });

    it('Trả về NotificationKindName khi kind hợp lệ', () => {
      expect(notificationKindOf({ kind: 'KYC_APPROVED' })).toBe('KYC_APPROVED');
      expect(notificationKindOf({ kind: 'KYC_REJECTED' })).toBe('KYC_REJECTED');
      expect(notificationKindOf({ kind: 'REFUND_COMPLETED' })).toBe('REFUND_COMPLETED');
    });
  });

  describe('useForegroundNotification', () => {
    it('Gọi onReceive khi push có kind thuộc danh sách kinds', async () => {
      const onReceive = jest.fn();
      const kinds = ['KYC_APPROVED', 'KYC_REJECTED'] as const;

      const { unmount } = await renderHook(() => useForegroundNotification(kinds, onReceive));

      expect(mockAddReceived).toHaveBeenCalledTimes(1);
      expect(mockListenerCb).not.toBeNull();

      // Giả lập nhận notification hợp lệ
      await act(async () => {
        mockListenerCb?.({
          request: {
            content: {
              data: {
                kind: 'KYC_APPROVED',
                deliveryId: '01890a5d-ac96-774b-bcce-b302099a8051',
              },
            },
          },
        });
      });

      expect(onReceive).toHaveBeenCalledTimes(1);
      expect(onReceive).toHaveBeenCalledWith('KYC_APPROVED');

      await unmount();
      expect(mockRemove).toHaveBeenCalledTimes(1);
    });

    it('Không gọi onReceive khi kind không thuộc danh sách hoặc payload sai', async () => {
      const onReceive = jest.fn();
      const kinds = ['KYC_APPROVED'] as const;

      const { unmount } = await renderHook(() => useForegroundNotification(kinds, onReceive));

      // Notification có kind khác
      await act(async () => {
        mockListenerCb?.({
          request: {
            content: {
              data: {
                kind: 'REFUND_COMPLETED',
              },
            },
          },
        });
      });

      // Notification sai cấu trúc data
      await act(async () => {
        mockListenerCb?.({
          request: {
            content: {
              data: null,
            },
          },
        });
      });

      expect(onReceive).not.toHaveBeenCalled();

      await unmount();
      expect(mockRemove).toHaveBeenCalledTimes(1);
    });
  });
});
