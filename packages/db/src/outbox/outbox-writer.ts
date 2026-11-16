import type { DomainEvent, Tx } from '@tamgiao/kernel';
import { outbox } from '../schema/platform.js';
import { asDbTx } from '../tx.js';

/**
 * Ghi domain event vào outbox **trong cùng transaction** với dữ liệu nghiệp vụ.
 * Repository gọi sau khi lưu aggregate: `await outboxWriter.append(tx, aggregate.pullEvents())`.
 */
export class OutboxWriter {
  async append(tx: Tx, events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    await asDbTx(tx)
      .insert(outbox)
      .values(
        events.map((e) => ({
          id: e.eventId,
          eventType: e.type,
          aggregateType: e.aggregateType,
          aggregateId: e.aggregateId,
          aggregateVersion: e.version,
          payload: e.payload,
          occurredAt: e.occurredAt,
        })),
      );
  }
}
