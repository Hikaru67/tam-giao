import { act, renderHook } from '@testing-library/react-native';
import { useScreenCaptureProtection } from './use-screen-capture-protection.js';

const mockPrevent = jest.fn(async (_key?: string) => undefined);
const mockAllow = jest.fn(async (_key?: string) => undefined);
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: (key?: string) => mockPrevent(key),
  allowScreenCaptureAsync: (key?: string) => mockAllow(key),
}));

// Giả lập focus/blur: useFocusEffect lưu effect; test gọi focus()/blur().
let mockEffect: (() => undefined | void | (() => void)) | null = null;
let mockCleanup: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => undefined | void | (() => void)) => {
    mockEffect = effect;
  },
}));

function focus(): void {
  const cleanup = mockEffect?.();
  mockCleanup = typeof cleanup === 'function' ? cleanup : null;
}

function blur(): void {
  mockCleanup?.();
  mockCleanup = null;
}

describe('useScreenCaptureProtection (FE-S6-03)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrevent.mockImplementation(async () => undefined);
    mockAllow.mockImplementation(async () => undefined);
    mockEffect = null;
    mockCleanup = null;
  });

  it("1. focus → preventScreenCaptureAsync gọi đúng 1 lần với 'chat'; chưa gọi allow", async () => {
    const { unmount } = await renderHook(() => useScreenCaptureProtection('chat'));

    await act(async () => {
      focus();
    });

    expect(mockPrevent).toHaveBeenCalledTimes(1);
    expect(mockPrevent).toHaveBeenCalledWith('chat');
    expect(mockAllow).not.toHaveBeenCalled();

    await unmount();
  });

  it("2. blur sau focus → allowScreenCaptureAsync gọi với cùng key 'chat'", async () => {
    const { unmount } = await renderHook(() => useScreenCaptureProtection('chat'));

    await act(async () => {
      focus();
    });
    await act(async () => {
      blur();
    });

    expect(mockAllow).toHaveBeenCalledTimes(1);
    expect(mockAllow).toHaveBeenCalledWith('chat');

    await unmount();
  });

  it('3. focus lại sau blur → preventScreenCaptureAsync được gọi lần 2', async () => {
    const { unmount } = await renderHook(() => useScreenCaptureProtection('chat'));

    await act(async () => {
      focus();
    });
    expect(mockPrevent).toHaveBeenCalledTimes(1);

    await act(async () => {
      blur();
    });
    expect(mockAllow).toHaveBeenCalledTimes(1);

    await act(async () => {
      focus();
    });
    expect(mockPrevent).toHaveBeenCalledTimes(2);
    expect(mockPrevent).toHaveBeenLastCalledWith('chat');

    await unmount();
  });

  it('4. chưa focus (chỉ render) → không gọi preventScreenCaptureAsync', async () => {
    const { unmount } = await renderHook(() => useScreenCaptureProtection('chat'));

    expect(mockEffect).not.toBeNull();
    expect(mockPrevent).not.toHaveBeenCalled();
    expect(mockAllow).not.toHaveBeenCalled();

    await unmount();
  });

  it('5. preventScreenCaptureAsync reject → không throw, không unhandled rejection, blur vẫn gọi allow', async () => {
    mockPrevent.mockRejectedValueOnce(new Error('Not supported on platform'));
    mockAllow.mockRejectedValueOnce(new Error('Not supported on platform'));

    const { unmount } = await renderHook(() => useScreenCaptureProtection('chat'));

    await act(async () => {
      focus();
      await Promise.resolve();
    });

    expect(mockPrevent).toHaveBeenCalledTimes(1);
    expect(mockPrevent).toHaveBeenCalledWith('chat');
    expect(mockAllow).not.toHaveBeenCalled();

    await act(async () => {
      blur();
      await Promise.resolve();
    });

    expect(mockAllow).toHaveBeenCalledTimes(1);
    expect(mockAllow).toHaveBeenCalledWith('chat');

    await unmount();
  });
});
