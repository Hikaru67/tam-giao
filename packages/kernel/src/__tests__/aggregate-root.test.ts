import { describe, expect, it } from 'vitest';
import { AggregateRoot, Entity } from '../entity.js';
import { newId, type Id } from '../id.js';

type CounterId = Id<'Counter'>;

class Counter extends AggregateRoot<CounterId> {
  protected readonly aggregateType = 'Counter';
  private constructor(
    id: CounterId,
    version: number,
    private value: number,
  ) {
    super(id, version);
  }
  static create(id = newId<'Counter'>()): Counter {
    return new Counter(id, 0, 0);
  }
  static rehydrate(id: CounterId, version: number, value: number): Counter {
    return new Counter(id, version, value);
  }
  increment(at: Date): void {
    this.value += 1;
    this.record('CounterIncremented', { value: this.value }, at);
  }
}

class Other extends Entity<CounterId> {
  constructor(id: CounterId) {
    super(id);
  }
}

describe('AggregateRoot', () => {
  const at = new Date('2026-01-01T00:00:00.000Z');

  it('pullEvents trả event theo thứ tự rồi xoá buffer (AC3)', () => {
    const c = Counter.create();
    c.increment(at);
    c.increment(at);
    const events = c.pullEvents();
    expect(events.map((e) => (e.payload as { value: number }).value)).toEqual([1, 2]);
    expect(c.pullEvents()).toEqual([]);
  });

  it('event mang đủ metadata và version tăng dần', () => {
    const c = Counter.rehydrate(newId<'Counter'>(), 5, 0);
    c.increment(at);
    const [e] = c.pullEvents();
    expect(e).toMatchObject({
      type: 'CounterIncremented',
      aggregateType: 'Counter',
      aggregateId: c.id,
      version: 6,
      occurredAt: at,
    });
    expect(e?.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.version).toBe(6);
  });

  it('occurredAt là bản sao, không bị ảnh hưởng khi Date gốc đổi', () => {
    const mutable = new Date(at.getTime());
    const c = Counter.create();
    c.increment(mutable);
    mutable.setUTCFullYear(2000);
    expect(c.pullEvents()[0]?.occurredAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it.each([-1, 1.5])('từ chối version không hợp lệ: %s', (v) => {
    expect(() => Counter.rehydrate(newId<'Counter'>(), v, 0)).toThrow(/version/);
  });

  it('Entity.equals so sánh theo class và id', () => {
    const id = newId<'Counter'>();
    expect(Counter.rehydrate(id, 0, 0).equals(Counter.rehydrate(id, 3, 9))).toBe(true);
    expect(Counter.create().equals(Counter.create())).toBe(false);
    expect(Counter.rehydrate(id, 0, 0).equals(new Other(id))).toBe(false);
  });
});
