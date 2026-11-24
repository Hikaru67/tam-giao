import {
  buildDateOptions,
  formatLocalDate,
  formatLocalTime,
  localDayKey,
  DATE_TIME_SLOTS,
} from './date-options.js';

describe('date-options (FE-S5-01)', () => {
  it('formats local date and local time correctly', () => {
    const d = new Date(2026, 10, 24, 9, 5);
    expect(formatLocalDate(d)).toBe('24/11/2026');
    expect(formatLocalTime(d)).toBe('09:05');
    expect(localDayKey(d)).toBe('2026-11-24');
  });

  it('marks past slots as disabled when startsAt <= now', () => {
    // now lúc 10:00 ngày 24/11/2026: slot sáng (9:00 - 11:00) đã bắt đầu trước now -> disabled
    const now = new Date(2026, 10, 24, 10, 0, 0);
    const until = new Date(2026, 10, 24, 23, 59, 59);

    const options = buildDateOptions(now, until);
    expect(options).toHaveLength(1);

    const day = options[0];
    expect(day).toBeDefined();
    expect(day?.dayKey).toBe('2026-11-24');

    const morningSlot = day?.slots.find((s) => s.id === 'morning');
    const afternoonSlot = day?.slots.find((s) => s.id === 'afternoon');

    expect(morningSlot?.disabled).toBe(true);
    expect(afternoonSlot?.disabled).toBe(false);
  });

  it('marks slots past until as disabled and respects until boundary', () => {
    // now lúc 8:00 sáng ngày 24/11/2026, until lúc 17:00 ngày 24/11/2026
    // slot chiều kết thúc lúc 18:00 > until 17:00 -> disabled
    const now = new Date(2026, 10, 24, 8, 0, 0);
    const until = new Date(2026, 10, 24, 17, 0, 0);

    const options = buildDateOptions(now, until);
    expect(options).toHaveLength(1);

    const day = options[0];
    const morningSlot = day?.slots.find((s) => s.id === 'morning');
    const afternoonSlot = day?.slots.find((s) => s.id === 'afternoon');

    // Slot sáng kết thúc lúc 11:00 <= 17:00 -> enabled
    expect(morningSlot?.disabled).toBe(false);
    // Slot chiều kết thúc lúc 18:00 > 17:00 -> disabled
    expect(afternoonSlot?.disabled).toBe(true);
  });

  it('drops empty days where all slots are disabled', () => {
    // now lúc 19:00 ngày 24/11/2026 (cả hai slot 9-11 và 16-18 đều đã qua)
    // until lúc 12:00 ngày 25/11/2026
    const now = new Date(2026, 10, 24, 19, 0, 0);
    const until = new Date(2026, 10, 25, 12, 0, 0);

    const options = buildDateOptions(now, until);
    // Ngày 24/11 bị bỏ qua hoàn toàn vì cả 2 slot đều disabled
    expect(options).toHaveLength(1);
    expect(options[0]?.dayKey).toBe('2026-11-25');

    const morningSlot = options[0]?.slots.find((s) => s.id === 'morning');
    const afternoonSlot = options[0]?.slots.find((s) => s.id === 'afternoon');
    expect(morningSlot?.disabled).toBe(false);
    // Slot chiều ngày 25 kết thúc lúc 18:00 > until 12:00 -> disabled
    expect(afternoonSlot?.disabled).toBe(true);
  });

  it('returns empty array when until is before now', () => {
    const now = new Date(2026, 10, 25, 10, 0, 0);
    const until = new Date(2026, 10, 24, 10, 0, 0);

    const options = buildDateOptions(now, until);
    expect(options).toEqual([]);
  });

  it('includes all DATE_TIME_SLOTS with exact hours', () => {
    expect(DATE_TIME_SLOTS).toEqual([
      { id: 'morning', startHour: 9, endHour: 11 },
      { id: 'afternoon', startHour: 16, endHour: 18 },
    ]);
  });
});
