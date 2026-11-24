import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useMaxBrightness } from './use-max-brightness.js';

const mockGetBrightnessAsync = jest.fn();
const mockSetBrightnessAsync = jest.fn();

jest.mock('expo-brightness', () => ({
  getBrightnessAsync: (...args: unknown[]) => mockGetBrightnessAsync(...args),
  setBrightnessAsync: (...args: unknown[]) => mockSetBrightnessAsync(...args),
}));

describe('useMaxBrightness', () => {
  beforeEach(() => {
    mockGetBrightnessAsync.mockReset();
    mockSetBrightnessAsync.mockReset();
  });

  it('lưu độ sáng hiện tại và đặt độ sáng 1 khi active', async () => {
    mockGetBrightnessAsync.mockResolvedValueOnce(0.35);
    mockSetBrightnessAsync.mockResolvedValue(undefined);

    const { unmount } = await renderHook(() => useMaxBrightness(true));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetBrightnessAsync).toHaveBeenCalledTimes(1);
    expect(mockSetBrightnessAsync).toHaveBeenCalledWith(1);

    await unmount();
    expect(mockSetBrightnessAsync).toHaveBeenCalledWith(0.35);
  });

  it('khôi phục độ sáng khi active chuyển sang false', async () => {
    mockGetBrightnessAsync.mockResolvedValueOnce(0.6);
    mockSetBrightnessAsync.mockResolvedValue(undefined);

    let active = true;
    const { rerender, unmount } = await renderHook(() => useMaxBrightness(active));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSetBrightnessAsync).toHaveBeenCalledWith(1);

    active = false;
    await act(async () => {
      await rerender({});
    });

    expect(mockSetBrightnessAsync).toHaveBeenCalledWith(0.6);

    await unmount();
  });

  it('tránh race condition: unmount trước khi getBrightnessAsync hoàn thành thì không đặt 1', async () => {
    let resolveGetBrightness: ((val: number) => void) | null = null;
    mockGetBrightnessAsync.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveGetBrightness = resolve;
        }),
    );
    mockSetBrightnessAsync.mockResolvedValue(undefined);

    const { unmount } = await renderHook(() => useMaxBrightness(true));

    // Unmount ngay lập tức trước khi Promise getBrightnessAsync phân giải
    await unmount();

    // Giờ mới phân giải getBrightnessAsync
    await act(async () => {
      if (resolveGetBrightness) {
        resolveGetBrightness(0.5);
      }
    });

    // setBrightnessAsync(1) tuyệt đối không được gọi
    expect(mockSetBrightnessAsync).not.toHaveBeenCalledWith(1);
  });

  it('khôi phục độ sáng khi AppState rời active và đặt lại 1 khi trở lại active', async () => {
    let appStateListener: ((state: string) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
      if (event === 'change') {
        appStateListener = listener as (state: string) => void;
      }
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });

    mockGetBrightnessAsync.mockResolvedValueOnce(0.45);
    mockSetBrightnessAsync.mockResolvedValue(undefined);

    const { unmount } = await renderHook(() => useMaxBrightness(true));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSetBrightnessAsync).toHaveBeenCalledWith(1);

    // AppState chuyển sang background
    await act(async () => {
      appStateListener?.('background');
    });
    expect(mockSetBrightnessAsync).toHaveBeenCalledWith(0.45);

    // AppState trở lại active
    await act(async () => {
      appStateListener?.('active');
    });
    expect(mockSetBrightnessAsync).toHaveBeenLastCalledWith(1);

    await unmount();
  });
});
