import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createUuidV4 } from './uuid.js';

describe('createUuidV4', () => {
  const uuidSchema = z.uuid();

  it('sinh UUID v4 hợp lệ theo z.uuid() với crypto.randomUUID', () => {
    const id = createUuidV4();
    expect(uuidSchema.safeParse(id).success).toBe(true);
    // Version 4: ký tự thứ 15 (index 14) là '4'
    expect(id.charAt(14)).toBe('4');
    // Variant RFC 4122: ký tự thứ 20 (index 19) là '8', '9', 'a' hoặc 'b'
    expect(['8', '9', 'a', 'b']).toContain(id.charAt(19).toLowerCase());
  });

  it('sinh UUID v4 hợp lệ theo z.uuid() khi dùng fallback generator', () => {
    // Truyền hàm random tùy biến để ép kích hoạt fallback generator
    let count = 0;
    const deterministicRandom = () => {
      count = (count + 1) % 100;
      return count / 100;
    };

    const id = createUuidV4(deterministicRandom);
    expect(uuidSchema.safeParse(id).success).toBe(true);
    expect(id.charAt(14)).toBe('4');
    expect(['8', '9', 'a', 'b']).toContain(id.charAt(19).toLowerCase());
  });

  it('sinh UUID v4 hợp lệ khi globalThis.crypto không có randomUUID', () => {
    // Giả lập môi trường Hermes / RN cũ thiếu randomUUID
    vi.stubGlobal('crypto', {});
    try {
      const id = createUuidV4();
      expect(uuidSchema.safeParse(id).success).toBe(true);
      expect(id.charAt(14)).toBe('4');
      expect(['8', '9', 'a', 'b']).toContain(id.charAt(19).toLowerCase());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('các lần sinh liên tiếp không bị trùng lặp', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(createUuidV4());
    }
    expect(ids.size).toBe(50);
  });
});
