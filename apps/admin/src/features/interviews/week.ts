const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const weekdayFormatter = new Intl.DateTimeFormat('vi-VN', { weekday: 'long' });

/**
 * Trả về Thứ Hai 00:00:00.000 giờ địa phương của tuần chứa `date`.
 */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Thêm số ngày vào `date` bằng `setDate` (chuẩn qua DST).
 */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Mảng 7 ngày tính từ `weekStart`.
 */
export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * Kiểm tra hai mốc thời gian có cùng ngày trong giờ địa phương.
 */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Định dạng giờ HH:mm theo giờ địa phương.
 */
export function formatTime(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return timeFormatter.format(date);
}

/**
 * Định dạng nhãn thứ và ngày dd/MM.
 */
export function formatDayLabel(date: Date): { weekday: string; date: string } {
  const weekday = weekdayFormatter.format(date);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return {
    weekday,
    date: `${day}/${month}`,
  };
}

/**
 * Định dạng khoảng tuần vd "23/11 – 29/11/2026".
 */
export function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  const startDay = String(weekStart.getDate()).padStart(2, '0');
  const startMonth = String(weekStart.getMonth() + 1).padStart(2, '0');
  const endDay = String(weekEnd.getDate()).padStart(2, '0');
  const endMonth = String(weekEnd.getMonth() + 1).padStart(2, '0');
  const endYear = weekEnd.getFullYear();
  return `${startDay}/${startMonth} – ${endDay}/${endMonth}/${endYear}`;
}

/**
 * Chuyển giá trị <input type="datetime-local"> ("YYYY-MM-DDTHH:mm") sang ISO UTC qua new Date(value).
 * Không hợp lệ hoặc rỗng → null.
 */
export function localInputToIso(value: string): string | null {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

/**
 * Chuyển Date sang định dạng "YYYY-MM-DDTHH:mm" theo giờ địa phương cho <input type="datetime-local">.
 */
export function toLocalInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Gom slot vào 7 ngày trong tuần của `weekStart`, sắp xếp tăng dần theo startsAt.
 * Slot ngoài tuần bị bỏ qua.
 */
export function groupSlotsByDay<T extends { startsAt: string }>(slots: readonly T[], weekStart: Date): T[][] {
  const days = weekDays(weekStart);
  const groups: T[][] = Array.from({ length: 7 }, () => []);

  for (const slot of slots) {
    const slotDate = new Date(slot.startsAt);
    const dayIndex = days.findIndex((day) => isSameLocalDay(day, slotDate));
    if (dayIndex >= 0 && dayIndex < 7) {
      groups[dayIndex]?.push(slot);
    }
  }

  for (const group of groups) {
    group.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }

  return groups;
}

/**
 * Giờ bắt đầu gợi ý khi mở slot: tuần đang xem ở tương lai → 09:00 Thứ Hai tuần đó;
 * ngược lại → đầu giờ kế tiếp tính từ `now` (luôn ở tương lai).
 */
export function defaultSlotStart(weekStart: Date, now: Date): Date {
  if (weekStart.getTime() > now.getTime()) {
    const d = new Date(weekStart.getTime());
    d.setHours(9, 0, 0, 0);
    return d;
  }
  const next = new Date(now.getTime());
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}
