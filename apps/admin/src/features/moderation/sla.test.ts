import { describe, it, expect } from 'vitest';
import { slaState, sortQueue, type SlaTarget } from './sla';

describe('slaState', () => {
  const baseTarget: SlaTarget = {
    urgent: true,
    dueAt: '2026-11-24T10:30:00.000Z',
    status: 'OPEN',
    overdue: false,
    createdAt: '2026-11-24T10:00:00.000Z',
  };

  it('dueAt null → none', () => {
    expect(slaState({ ...baseTarget, dueAt: null }, Date.parse('2026-11-24T10:15:00.000Z'))).toEqual({
      kind: 'none',
    });
  });

  it('status RESOLVED hoặc DISMISSED → none kể cả dueAt quá khứ', () => {
    expect(slaState({ ...baseTarget, status: 'RESOLVED' }, Date.parse('2026-11-24T11:00:00.000Z'))).toEqual({
      kind: 'none',
    });
    expect(slaState({ ...baseTarget, status: 'DISMISSED' }, Date.parse('2026-11-24T11:00:00.000Z'))).toEqual({
      kind: 'none',
    });
  });

  it('overdue true → overdue', () => {
    expect(slaState({ ...baseTarget, overdue: true }, Date.parse('2026-11-24T10:15:00.000Z'))).toEqual({
      kind: 'overdue',
      dueAt: baseTarget.dueAt,
    });
  });

  it('now >= Date.parse(dueAt) → overdue', () => {
    expect(slaState(baseTarget, Date.parse('2026-11-24T10:30:00.000Z'))).toEqual({
      kind: 'overdue',
      dueAt: baseTarget.dueAt,
    });
    expect(slaState(baseTarget, Date.parse('2026-11-24T10:30:01.000Z'))).toEqual({
      kind: 'overdue',
      dueAt: baseTarget.dueAt,
    });
  });

  it('now < Date.parse(dueAt) và overdue false → remaining', () => {
    expect(slaState(baseTarget, Date.parse('2026-11-24T10:20:00.000Z'))).toEqual({
      kind: 'remaining',
      dueAt: baseTarget.dueAt,
    });
  });
});

describe('sortQueue', () => {
  it('đưa urgent lên đầu và giữ nguyên thứ tự trong từng nhóm', () => {
    const items = [
      { id: '1', urgent: false },
      { id: '2', urgent: true },
      { id: '3', urgent: false },
      { id: '4', urgent: true },
      { id: '5', urgent: false },
    ];

    const sorted = sortQueue(items);
    expect(sorted.map((i) => i.id)).toEqual(['2', '4', '1', '3', '5']);
    expect(items.map((i) => i.id)).toEqual(['1', '2', '3', '4', '5']); // không mutate mảng gốc
  });
});
