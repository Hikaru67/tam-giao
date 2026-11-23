import { describe, it, expect } from 'vitest';
import {
  startOfWeek,
  addDays,
  weekDays,
  isSameLocalDay,
  formatTime,
  formatDayLabel,
  formatWeekRange,
  localInputToIso,
  toLocalInputValue,
  groupSlotsByDay,
  defaultSlotStart,
} from './week';

describe('week helpers', () => {
  it('startOfWeek với Thứ Hai trả về chính ngày đó lúc 00:00:00 local', () => {
    // 2026-11-23 là Thứ Hai
    const monday = new Date(2026, 10, 23, 14, 30, 45);
    const start = startOfWeek(monday);

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(10);
    expect(start.getDate()).toBe(23);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it('startOfWeek với Chủ Nhật trả về Thứ Hai trước đó', () => {
    // 2026-11-29 là Chủ Nhật
    const sunday = new Date(2026, 10, 29, 23, 59, 59);
    const start = startOfWeek(sunday);

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(10);
    expect(start.getDate()).toBe(23); // Thứ Hai 23/11
    expect(start.getDay()).toBe(1);
    expect(start.getHours()).toBe(0);
  });

  it('startOfWeek với Thứ Tư trả về Thứ Hai của tuần đó', () => {
    // 2026-11-25 là Thứ Tư
    const wed = new Date(2026, 10, 25, 9, 15);
    const start = startOfWeek(wed);

    expect(start.getDate()).toBe(23);
    expect(start.getDay()).toBe(1);
  });

  it('addDays cộng và trừ ngày chính xác', () => {
    const monday = new Date(2026, 10, 23);
    const sunday = addDays(monday, 6);
    expect(sunday.getDate()).toBe(29);

    const prevDay = addDays(monday, -1);
    expect(prevDay.getDate()).toBe(22);
  });

  it('weekDays trả về 7 ngày liên tiếp từ Thứ Hai đến Chủ Nhật', () => {
    const monday = new Date(2026, 10, 23);
    const days = weekDays(monday);

    expect(days).toHaveLength(7);
    expect(days[0]?.getDate()).toBe(23);
    expect(days[6]?.getDate()).toBe(29);
    expect(days[0]?.getDay()).toBe(1); // T2
    expect(days[6]?.getDay()).toBe(0); // CN
  });

  it('isSameLocalDay kiểm tra chính xác ngày local', () => {
    const a = new Date(2026, 10, 23, 8, 0);
    const b = new Date(2026, 10, 23, 22, 30);
    const c = new Date(2026, 10, 24, 8, 0);

    expect(isSameLocalDay(a, b)).toBe(true);
    expect(isSameLocalDay(a, c)).toBe(false);
  });

  it('formatTime định dạng giờ phút theo vi-VN', () => {
    const date = new Date(2026, 10, 23, 9, 5);
    const formatted = formatTime(date);
    expect(formatted).toBe('09:05');
  });

  it('formatDayLabel trả về thứ và ngày dd/MM', () => {
    const date = new Date(2026, 10, 23);
    const label = formatDayLabel(date);
    expect(label.date).toBe('23/11');
    expect(label.weekday.toLowerCase()).toContain('hai');
  });

  it('formatWeekRange định dạng chuẩn "dd/MM – dd/MM/YYYY"', () => {
    const monday = new Date(2026, 10, 23);
    const range = formatWeekRange(monday);
    expect(range).toBe('23/11 – 29/11/2026');
  });

  it('toLocalInputValue và localInputToIso round-trip chính xác', () => {
    const original = new Date(2026, 10, 25, 10, 30);
    const localStr = toLocalInputValue(original);
    expect(localStr).toBe('2026-11-25T10:30');

    const iso = localInputToIso(localStr);
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getTime()).toBe(original.getTime());
  });

  it('localInputToIso trả về null với chuỗi rỗng hoặc không hợp lệ', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('   ')).toBeNull();
    expect(localInputToIso('invalid-date')).toBeNull();
  });

  it('groupSlotsByDay sắp xếp tăng dần và loại bỏ slot ngoài tuần', () => {
    const monday = new Date(2026, 10, 23);

    const slots = [
      // Ngoài tuần: tuần trước
      { startsAt: new Date(2026, 10, 22, 10, 0).toISOString(), id: 'past' },
      // Thứ Hai 14:00
      { startsAt: new Date(2026, 10, 23, 14, 0).toISOString(), id: 'mon-2' },
      // Thứ Hai 09:00
      { startsAt: new Date(2026, 10, 23, 9, 0).toISOString(), id: 'mon-1' },
      // Thứ Tư 10:00
      { startsAt: new Date(2026, 10, 25, 10, 0).toISOString(), id: 'wed-1' },
      // Ngoài tuần: tuần sau
      { startsAt: new Date(2026, 10, 30, 9, 0).toISOString(), id: 'next' },
    ];

    const grouped = groupSlotsByDay(slots, monday);
    expect(grouped).toHaveLength(7);

    // Thứ Hai: 2 slots, đã sắp xếp mon-1 trước mon-2
    expect(grouped[0]).toHaveLength(2);
    expect(grouped[0]?.[0]?.id).toBe('mon-1');
    expect(grouped[0]?.[1]?.id).toBe('mon-2');

    // Thứ Ba (index 1): rỗng
    expect(grouped[1]).toHaveLength(0);

    // Thứ Tư (index 2): 1 slot
    expect(grouped[2]).toHaveLength(1);
    expect(grouped[2]?.[0]?.id).toBe('wed-1');

    // Không chứa slot ngoài tuần
    const allGroupedIds = grouped.flat().map((s) => s.id);
    expect(allGroupedIds).not.toContain('past');
    expect(allGroupedIds).not.toContain('next');
  });

  it('defaultSlotStart: tuần đang xem ở tương lai → 09:00 Thứ Hai tuần đó', () => {
    const now = new Date(2026, 10, 25, 14, 20);
    const nextWeek = new Date(2026, 10, 30, 0, 0);
    expect(defaultSlotStart(nextWeek, now)).toEqual(new Date(2026, 10, 30, 9, 0));
  });

  it('defaultSlotStart: tuần hiện tại/quá khứ → đầu giờ kế tiếp từ bây giờ', () => {
    const now = new Date(2026, 10, 25, 14, 20);
    expect(defaultSlotStart(new Date(2026, 10, 23), now)).toEqual(new Date(2026, 10, 25, 15, 0));
    expect(defaultSlotStart(new Date(2026, 10, 16), now)).toEqual(new Date(2026, 10, 25, 15, 0));
  });
});
