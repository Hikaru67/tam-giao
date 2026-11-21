import { DATING_DAYS } from '@tamgiao/contracts/constants';
import { addDuration, newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { Conversation } from '../domain/conversation.js';
import { ICEBREAKER_STAGES, icebreakersForDay } from '../domain/icebreakers.js';

const T0 = new Date('2026-06-01T08:00:00.000Z');
const A = newId<'User'>();
const B = newId<'User'>();

const open = (): Conversation =>
  Conversation.open(
    {
      id: newId<'Conversation'>(),
      matchId: newId(),
      participants: [A, B],
      openedAt: T0,
      closesAt: addDuration(T0, { days: DATING_DAYS }),
    },
    T0,
  );

describe('Conversation.datingDay — ngày X/DATING_DAYS', () => {
  it.each([
    ['trước lúc mở', addDuration(T0, { hours: -5 }), 1],
    ['ngay lúc mở', T0, 1],
    ['23h59 sau khi mở', addDuration(T0, { hours: 23, minutes: 59 }), 1],
    ['tròn 24h', addDuration(T0, { days: 1 }), 2],
    ['ngày cuối', addDuration(T0, { days: DATING_DAYS - 1, hours: 3 }), DATING_DAYS],
    ['đúng closesAt', addDuration(T0, { days: DATING_DAYS }), DATING_DAYS],
    ['quá hạn lâu', addDuration(T0, { days: 40 }), DATING_DAYS],
  ])('%s → ngày %i', (_name, now, day) => {
    expect(open().datingDay(now)).toBe(day);
  });

  it('hội thoại đóng → dừng ở ngày đóng', () => {
    const c = open();
    c.close('MATCH_CLOSED', addDuration(T0, { days: 4, hours: 2 }));
    expect(c.datingDay(addDuration(T0, { days: 10 }))).toBe(5);
  });

  it('peerOf: người còn lại; người ngoài → null', () => {
    const c = open();
    expect(c.peerOf(A.toUpperCase())).toBe(B);
    expect(c.peerOf(B)).toBe(A);
    expect(c.peerOf(newId())).toBeNull();
  });
});

describe('ICEBREAKER_STAGES', () => {
  it('phủ kín 1…DATING_DAYS, không chồng lấn, mỗi chặng có gợi ý', () => {
    const covered: number[] = [];
    for (const stage of ICEBREAKER_STAGES) {
      expect(stage.topics.length).toBeGreaterThan(0);
      for (let d = stage.fromDay; d <= stage.toDay; d += 1) covered.push(d);
    }
    expect(covered).toEqual(Array.from({ length: DATING_DAYS }, (_, i) => i + 1));
  });

  it('icebreakersForDay: chọn theo ngày, ngoài khoảng bị kẹp', () => {
    expect(icebreakersForDay(1).theme).toBe('Làm quen');
    expect(icebreakersForDay(9).theme).toBe('Chủ đề sâu');
    expect(icebreakersForDay(0)).toBe(icebreakersForDay(1));
    expect(icebreakersForDay(99)).toBe(icebreakersForDay(DATING_DAYS));
  });
});
