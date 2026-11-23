import { INTERVIEW_CHANGE_CUTOFF_HOURS } from '@tamgiao/contracts/constants';
import type {
  AvailableInterviewSlotListResponse,
  MyInterviewResponse,
} from '@tamgiao/contracts/verification';

export type AvailableInterviewSlot = AvailableInterviewSlotListResponse['items'][number];
export type InterviewBooking = NonNullable<MyInterviewResponse['booking']>;

export interface InterviewSlotDay {
  /** Khoá ngày theo giờ địa phương, dạng `YYYY-MM-DD`. */
  dayKey: string;
  /** Mốc 00:00 giờ địa phương của ngày — dùng để hiển thị nhãn ngày. */
  date: Date;
  slots: AvailableInterviewSlot[];
}

const pad = (n: number): string => n.toString().padStart(2, '0');

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Nhóm slot trống theo ngày (giờ địa phương của máy), tăng dần theo giờ bắt đầu. */
export function groupSlotsByLocalDay(slots: readonly AvailableInterviewSlot[]): InterviewSlotDay[] {
  const sorted = [...slots].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const days: InterviewSlotDay[] = [];
  for (const slot of sorted) {
    const start = new Date(slot.startsAt);
    const key = localDayKey(start);
    const last = days[days.length - 1];
    if (last?.dayKey === key) {
      last.slots.push(slot);
    } else {
      days.push({
        dayKey: key,
        date: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
        slots: [slot],
      });
    }
  }
  return days;
}

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/** `HH:mm` theo giờ địa phương. */
export function formatLocalTime(value: string | Date): string {
  const d = toDate(value);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `dd/MM/yyyy` theo giờ địa phương. */
export function formatLocalDate(value: string | Date): string {
  const d = toDate(value);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Mốc cuối còn được huỷ/đổi lịch = giờ bắt đầu − `INTERVIEW_CHANGE_CUTOFF_HOURS`. */
export function changeDeadlineOf(startsAt: string): Date {
  return new Date(Date.parse(startsAt) - INTERVIEW_CHANGE_CUTOFF_HOURS * 3_600_000);
}

/**
 * Lịch đã đặt có bị khoá huỷ/đổi không: server báo `canChange = false`, hoặc đồng hồ (inject) đã tới mốc
 * `changeDeadlineOf(startsAt)`. Server vẫn là nguồn chân lý cuối (`CANCEL_TOO_LATE`); app chỉ khoá sớm để không gửi
 * yêu cầu chắc chắn bị từ chối.
 */
export function isChangeLocked(booking: InterviewBooking, now: Date): boolean {
  return !booking.canChange || now.getTime() >= changeDeadlineOf(booking.startsAt).getTime();
}
