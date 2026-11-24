export const DATE_TIME_SLOTS = [
  { id: 'morning', startHour: 9, endHour: 11 },
  { id: 'afternoon', startHour: 16, endHour: 18 },
] as const;

export type DateTimeSlotId = (typeof DATE_TIME_SLOTS)[number]['id'];

export interface DateOptionSlot {
  readonly id: DateTimeSlotId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly disabled: boolean;
}

export interface DateOptionDay {
  readonly dayKey: string;
  readonly date: Date;
  readonly slots: readonly DateOptionSlot[];
}

const pad = (n: number): string => n.toString().padStart(2, '0');

export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatLocalDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatLocalTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Tạo danh sách ngày và khung giờ hẹn gợi ý theo giờ địa phương,
 * từ hôm nay (theo `now`) tới ngày của `until`.
 *
 * Một slot bị vô hiệu hoá khi `startsAt <= now` (quá khứ) hoặc `endsAt > until` (vượt hạn tìm hiểu).
 * Ngày mà mọi slot đều bị vô hiệu hoá sẽ được lọc bỏ.
 */
export function buildDateOptions(now: Date, until: Date): DateOptionDay[] {
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const untilDay = new Date(until.getFullYear(), until.getMonth(), until.getDate());

  if (nowDay.getTime() > untilDay.getTime()) {
    return [];
  }

  const result: DateOptionDay[] = [];
  const currentCursor = new Date(nowDay.getTime());

  while (currentCursor.getTime() <= untilDay.getTime()) {
    const year = currentCursor.getFullYear();
    const month = currentCursor.getMonth();
    const date = currentCursor.getDate();

    const slots: DateOptionSlot[] = DATE_TIME_SLOTS.map((slotDef) => {
      const startsAt = new Date(year, month, date, slotDef.startHour, 0, 0, 0);
      const endsAt = new Date(year, month, date, slotDef.endHour, 0, 0, 0);
      const disabled = startsAt.getTime() <= now.getTime() || endsAt.getTime() > until.getTime();
      return {
        id: slotDef.id,
        startsAt,
        endsAt,
        disabled,
      };
    });

    const anyEnabled = slots.some((s) => !s.disabled);
    if (anyEnabled) {
      result.push({
        dayKey: localDayKey(currentCursor),
        date: new Date(year, month, date),
        slots,
      });
    }

    currentCursor.setDate(currentCursor.getDate() + 1);
  }

  return result;
}
