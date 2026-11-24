// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrCreateDeviceId,
  isValidDeviceId,
  resetDeviceIdMemoryForTesting,
  DEVICE_ID_STORAGE_KEY,
  type LocalStorageLike,
} from './device-id';

describe('device-id', () => {
  beforeEach(() => {
    resetDeviceIdMemoryForTesting();
  });

  it('sinh mã deviceId hợp lệ theo regex chuẩn 8-128 ký tự', () => {
    const memoryStorage: Record<string, string> = {};
    const storage: LocalStorageLike = {
      getItem: (key) => memoryStorage[key] ?? null,
      setItem: (key, value) => {
        memoryStorage[key] = value;
      },
    };

    const id = getOrCreateDeviceId(storage);
    expect(isValidDeviceId(id)).toBe(true);
    expect(storage.getItem(DEVICE_ID_STORAGE_KEY)).toBe(id);
  });

  it('ổn định: gọi nhiều lần trả về cùng một mã thiết bị', () => {
    const memoryStorage: Record<string, string> = {};
    const storage: LocalStorageLike = {
      getItem: (key) => memoryStorage[key] ?? null,
      setItem: (key, value) => {
        memoryStorage[key] = value;
      },
    };

    const first = getOrCreateDeviceId(storage);
    const second = getOrCreateDeviceId(storage);
    expect(first).toBe(second);
  });

  it('nếu storage có sẵn deviceId hợp lệ thì tái sử dụng mà không sinh mới', () => {
    const existing = 'custom-device-id-12345';
    const storage: LocalStorageLike = {
      getItem: () => existing,
      setItem: () => {},
    };

    const id = getOrCreateDeviceId(storage);
    expect(id).toBe(existing);
  });

  it('khi storage bị lỗi (chặn truy cập), lưu và giữ ổn định trong bộ nhớ', () => {
    const failingStorage: LocalStorageLike = {
      getItem: () => {
        throw new Error('Storage access denied');
      },
      setItem: () => {
        throw new Error('Storage access denied');
      },
    };

    const first = getOrCreateDeviceId(failingStorage);
    expect(isValidDeviceId(first)).toBe(true);
    const second = getOrCreateDeviceId(failingStorage);
    expect(second).toBe(first);
  });
});
