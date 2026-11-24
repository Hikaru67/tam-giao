import { vi } from 'vitest';

/**
 * Giả lập các API DOM cho môi trường jsdom:
 * - HTMLMediaElement.prototype.play / pause
 * - HTMLCanvasElement.prototype.getContext
 */
export function setupMockMediaAndCanvas() {
  HTMLMediaElement.prototype.play = vi.fn().mockImplementation(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => undefined }] }) },
  });
  HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation(() => ({
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
      data: new Uint8ClampedArray(16),
      width: 2,
      height: 2,
    }),
  }));
}
