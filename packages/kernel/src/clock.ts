/** Nguồn thời gian. Domain/application chỉ lấy giờ qua port này (AGENTS.md A7). */
export interface Clock {
  now(): Date;
}

export interface Duration {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}

const MS = { seconds: 1_000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;

export function durationToMs(d: Duration): number {
  return (
    (d.days ?? 0) * MS.days +
    (d.hours ?? 0) * MS.hours +
    (d.minutes ?? 0) * MS.minutes +
    (d.seconds ?? 0) * MS.seconds +
    (d.milliseconds ?? 0)
  );
}

/** Cộng khoảng thời gian (theo mốc UTC tuyệt đối, không phụ thuộc múi giờ). Trả về Date mới. */
export function addDuration(date: Date, d: Duration): Date {
  return new Date(date.getTime() + durationToMs(d));
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Đồng hồ giả cho test: đứng yên cho tới khi gọi `set`/`advance`. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }

  advance(d: Duration): Date {
    this.current = addDuration(this.current, d);
    return this.now();
  }
}
