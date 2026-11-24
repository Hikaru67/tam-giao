// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { useQrCamera } from './use-qr-camera';
import * as decodeFrameModule from './decode-frame';

describe('useQrCamera', () => {
  let mockTracks: { stop: ReturnType<typeof vi.fn> }[];
  let mockStream: { getTracks: ReturnType<typeof vi.fn> };
  let originalMediaDevices: MediaDevices | undefined;

  beforeEach(() => {
    mockTracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    mockStream = {
      getTracks: vi.fn().mockReturnValue(mockTracks),
    };

    originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    HTMLMediaElement.prototype.play = vi.fn().mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: originalMediaDevices,
    });
    vi.restoreAllMocks();
  });

  it('khi enabled = false: trạng thái là idle và không yêu cầu getUserMedia', () => {
    const onDecode = vi.fn();
    const { result } = renderHook(() => useQrCamera({ enabled: false, onDecode }));

    expect(result.current.status).toBe('idle');
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('khi enabled = true: mở camera thành công và chuyển trạng thái sang running', async () => {
    const onDecode = vi.fn();
    const { result } = renderHook(() => useQrCamera({ enabled: true, onDecode }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.status).toBe('running');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  });

  it('dừng toàn bộ tracks khi unmount', async () => {
    const onDecode = vi.fn();
    const { unmount } = renderHook(() => useQrCamera({ enabled: true, onDecode }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    unmount();

    expect(mockTracks[0]?.stop).toHaveBeenCalled();
    expect(mockTracks[1]?.stop).toHaveBeenCalled();
  });

  it('ẩn tab khi đang chờ quyền rồi hiện lại → stream của phiên cũ bị dừng, chỉ giữ một camera', async () => {
    const pending: ((stream: unknown) => void)[] = [];
    const makeStream = () => {
      const stop = vi.fn();
      return { stop, stream: { getTracks: () => [{ stop }] } };
    };
    navigator.mediaDevices.getUserMedia = vi.fn(
      () => new Promise((resolve) => pending.push(resolve as (stream: unknown) => void)),
    ) as unknown as MediaDevices['getUserMedia'];
    const hidden = vi.spyOn(document, 'hidden', 'get');

    const { result } = renderHook(() => useQrCamera({ enabled: true, onDecode: vi.fn() }));
    hidden.mockReturnValue(true);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    hidden.mockReturnValue(false);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(pending).toHaveLength(2);

    const first = makeStream();
    const second = makeStream();
    await act(async () => {
      pending[1]?.(second.stream);
      pending[0]?.(first.stream);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.stop).not.toHaveBeenCalled();
    expect(result.current.status).toBe('running');
  });

  it('người dùng từ chối cấp quyền (NotAllowedError) → status denied', async () => {
    const deniedError = new Error('Permission denied');
    deniedError.name = 'NotAllowedError';

    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(deniedError);

    const onDecode = vi.fn();
    const { result } = renderHook(() => useQrCamera({ enabled: true, onDecode }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.status).toBe('denied');
  });

  it('thiết bị không có camera (NotFoundError) → status unavailable', async () => {
    const notFoundError = new Error('No camera found');
    notFoundError.name = 'NotFoundError';

    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(notFoundError);

    const onDecode = vi.fn();
    const { result } = renderHook(() => useQrCamera({ enabled: true, onDecode }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.status).toBe('unavailable');
  });

  it('không có mediaDevices trong trình duyệt → status unavailable', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const onDecode = vi.fn();
    const { result } = renderHook(() => useQrCamera({ enabled: true, onDecode }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.status).toBe('unavailable');
  });

  it('giải mã thành công gọi onDecode và không gọi trùng cùng chuỗi liên tiếp', async () => {
    const decodeSpy = vi.spyOn(decodeFrameModule, 'decodeQr');
    decodeSpy.mockReturnValue('VOUCHER_CODE_123');

    const onDecode = vi.fn();

    // Giả lập video element và canvas
    const mockVideo = document.createElement('video');
    Object.defineProperty(mockVideo, 'readyState', { value: 4 });
    Object.defineProperty(mockVideo, 'videoWidth', { value: 640 });
    Object.defineProperty(mockVideo, 'videoHeight', { value: 480 });

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray(640 * 480 * 4),
      }),
    });

    const { result } = renderHook(() => useQrCamera({ enabled: true, onDecode }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Gắn mockVideo vào videoRef
    Object.defineProperty(result.current.videoRef, 'current', {
      writable: true,
      value: mockVideo,
    });

    // Chạy một frame rAF
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(onDecode).toHaveBeenCalledWith('VOUCHER_CODE_123');
    const firstCallCount = onDecode.mock.calls.length;

    // Chạy thêm một frame nữa với cùng mã
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    // Không được gọi trùng lần 2 cho cùng mã
    expect(onDecode.mock.calls.length).toBe(firstCallCount);
  });
});
