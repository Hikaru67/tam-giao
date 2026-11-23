/**
 * Nguồn thời gian inject được cho màn phỏng vấn: component không gọi `Date.now()` / `new Date()` trực tiếp,
 * test truyền đồng hồ cố định để kiểm tra mốc khoá huỷ/đổi lịch.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Đồng hồ cố định cho test. */
export function createFixedClock(iso: string): Clock {
  const fixed = Date.parse(iso);
  return { now: () => new Date(fixed) };
}
