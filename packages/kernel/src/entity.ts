import type { DomainEvent } from './domain-event.js';
import { newId } from './id.js';

/** Đối tượng có danh tính: hai entity bằng nhau khi cùng `id`. */
export abstract class Entity<TId extends string> {
  protected constructor(readonly id: TId) {}

  equals(other: Entity<TId>): boolean {
    return other.constructor === this.constructor && other.id === this.id;
  }
}

/**
 * Gốc của aggregate: ranh giới nhất quán và nơi ghi nhận domain event.
 * `version` tăng mỗi lần `record()`; repository dùng để kiểm tra xung đột (optimistic) và ghi outbox.
 */
export abstract class AggregateRoot<TId extends string> extends Entity<TId> {
  protected abstract readonly aggregateType: string;
  private pending: DomainEvent[] = [];
  private currentVersion: number;

  protected constructor(id: TId, version = 0) {
    super(id);
    if (!Number.isInteger(version) || version < 0) {
      throw new Error(`version không hợp lệ: ${String(version)}`);
    }
    this.currentVersion = version;
  }

  get version(): number {
    return this.currentVersion;
  }

  protected record<TType extends string, TPayload>(
    type: TType,
    payload: TPayload,
    occurredAt: Date,
  ): DomainEvent<TType, TPayload> {
    this.currentVersion += 1;
    const event: DomainEvent<TType, TPayload> = {
      eventId: newId<'DomainEvent'>(),
      type,
      aggregateType: this.aggregateType,
      aggregateId: this.id,
      version: this.currentVersion,
      occurredAt: new Date(occurredAt.getTime()),
      payload,
    };
    this.pending.push(event);
    return event;
  }

  /** Lấy và xoá các event chưa phát, theo đúng thứ tự ghi nhận. */
  pullEvents(): DomainEvent[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }
}
