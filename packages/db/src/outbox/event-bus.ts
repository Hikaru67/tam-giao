import type { DomainEvent, Tx } from '@tamgiao/kernel';

/** Handler của một consumer. Chạy trong transaction; throw → rollback và thử lại. */
export type EventHandler = (event: DomainEvent, tx: Tx) => Promise<void>;

export interface Subscription {
  readonly eventType: string;
  /** Tên consumer duy nhất toàn hệ thống, quy ước `<module>.<việc>` (vd `messaging.open-conversation`). */
  readonly consumer: string;
  readonly handler: EventHandler;
}

const CONSUMER_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

/** Danh bạ consumer: mỗi consumer xử lý đúng 1 loại event và có hàng đợi riêng (lỗi của consumer này không chặn consumer khác). */
export class EventBus {
  private readonly subscriptions = new Map<string, Subscription>();

  on(eventType: string, consumer: string, handler: EventHandler): void {
    if (!CONSUMER_PATTERN.test(consumer)) {
      throw new Error(`Tên consumer "${consumer}" phải dạng <module>.<việc> (chữ thường, gạch ngang)`);
    }
    if (this.subscriptions.has(consumer)) {
      throw new Error(`Consumer "${consumer}" đã được đăng ký`);
    }
    this.subscriptions.set(consumer, { eventType, consumer, handler });
  }

  consumersOf(eventType: string): readonly Subscription[] {
    return [...this.subscriptions.values()].filter((s) => s.eventType === eventType);
  }

  list(): readonly Subscription[] {
    return [...this.subscriptions.values()];
  }
}

export const consumerQueue = (consumer: string): string => `evt.${consumer}`;
