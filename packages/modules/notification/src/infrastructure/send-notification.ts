import { ok, type Clock, type Tx, type UnitOfWork } from '@tamgiao/kernel';
import type { PushOutcome, PushSender } from '../application/ports/push-sender.js';
import type { PhoneDirectory, SmsSender } from '../application/ports/sms.js';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isCategoryEnabled,
  smsTextFor,
  templateFor,
} from '../domain/templates.js';
import type {
  DeliveryChannel,
  DeliverySkipReason,
  DeliveryStatus,
  DrizzleNotificationStore,
} from './drizzle-notification-store.js';

export type SendNotificationOutcome =
  | {
      readonly kind: 'SENT';
      readonly channel: DeliveryChannel;
      readonly pushedDevices: number;
      readonly removedDevices: number;
    }
  | { readonly kind: 'SKIPPED'; readonly reason: DeliverySkipReason; readonly removedDevices: number }
  | { readonly kind: 'FAILED'; readonly reason: DeliverySkipReason; readonly removedDevices: number }
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'ALREADY_DONE'; readonly status: DeliveryStatus }
  | { readonly kind: 'NOT_DUE'; readonly sendAfter: Date };

/** Lỗi push tạm thời ở mọi thiết bị (không thiết bị nào nhận) → job ném lỗi này để pg-boss thử lại. */
export class PushTemporarilyFailedError extends Error {
  constructor(
    readonly deliveryId: string,
    readonly codes: readonly string[],
  ) {
    super(`notification ${deliveryId}: push lỗi tạm thời (${codes.join(', ')})`);
    this.name = 'PushTemporarilyFailedError';
  }
}

export interface SendNotificationDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly store: DrizzleNotificationStore;
  readonly push: PushSender;
  /** SMS thay thế cho thông báo giao dịch khi không push được (cần cả `sms` lẫn `phones`). */
  readonly sms?: SmsSender;
  readonly phones?: PhoneDirectory;
}

/**
 * Gửi **một** thông báo (job `notification.send`). Hai transaction ngắn, gọi nhà cung cấp ở giữa (không giữ connection):
 * (1) đọc thông báo + cài đặt + token thiết bị; (2) xoá token hỏng (AC2) + chốt trạng thái `PENDING → SENT|SKIPPED|FAILED`
 * có điều kiện (`WHERE status = 'PENDING'`). Idempotent: thông báo đã chốt / bị huỷ → `ALREADY_DONE`, không gửi lại.
 * Lỗi tạm thời ở mọi thiết bị → xoá token hỏng rồi throw `PushTemporarilyFailedError` (thông báo giữ `PENDING`, retry).
 */
export class SendNotification {
  constructor(private readonly deps: SendNotificationDeps) {}

  private async inTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const result = await this.deps.uow.run(async (tx) => ok(await work(tx)));
    return result.match(
      (value) => value,
      () => {
        throw new Error('unreachable');
      },
    );
  }

  async execute(deliveryId: string): Promise<SendNotificationOutcome> {
    const { store, clock, push } = this.deps;
    const loaded = await this.inTx(async (tx) => {
      const delivery = await store.findDelivery(tx, deliveryId);
      if (delivery === null || delivery.status !== 'PENDING') return { delivery, prefs: null, tokens: [] };
      const prefs = (await store.findPreferences(tx, delivery.userId)) ?? DEFAULT_NOTIFICATION_PREFERENCES;
      return { delivery, prefs, tokens: await store.listDeviceTokens(tx, delivery.userId) };
    });
    const { delivery, prefs, tokens } = loaded;
    if (delivery === null) return { kind: 'NOT_FOUND' };
    if (delivery.status !== 'PENDING' || prefs === null)
      return { kind: 'ALREADY_DONE', status: delivery.status };
    if (delivery.sendAfter.getTime() > clock.now().getTime())
      return { kind: 'NOT_DUE', sendAfter: delivery.sendAfter };

    const template = templateFor(delivery.kind);
    if (!isCategoryEnabled(template.category, prefs)) {
      return this.finish(deliveryId, delivery.userId, [], { status: 'SKIPPED', reason: 'OPTED_OUT' });
    }

    const data = { kind: delivery.kind, deliveryId, ...delivery.data };
    const outcomes: readonly PushOutcome[] =
      tokens.length === 0
        ? []
        : await push.send(
            tokens.map((t) => ({ token: t.token, title: template.title, body: template.body, data })),
          );
    if (outcomes.length !== tokens.length) {
      throw new Error(
        `notification ${deliveryId}: PushSender trả ${outcomes.length}/${tokens.length} kết quả`,
      );
    }
    const invalidTokens = tokens
      .filter((_, i) => outcomes[i]?.status === 'INVALID_TOKEN')
      .map((t) => t.token);
    const pushed = outcomes.filter((o) => o.status === 'OK').length;
    if (pushed > 0) {
      return this.finish(
        deliveryId,
        delivery.userId,
        invalidTokens,
        { status: 'SENT', channel: 'PUSH' },
        pushed,
      );
    }

    const errors = outcomes.flatMap((o) => (o.status === 'ERROR' ? [o] : []));
    const temporary = errors.filter((e) => e.retryable);
    if (temporary.length > 0) {
      await this.inTx((tx) => store.deleteDeviceTokens(tx, delivery.userId, invalidTokens));
      throw new PushTemporarilyFailedError(
        deliveryId,
        temporary.map((e) => e.code),
      );
    }

    if (template.smsFallback && (await this.sendSms(delivery.userId, smsTextFor(template)))) {
      return this.finish(deliveryId, delivery.userId, invalidTokens, { status: 'SENT', channel: 'SMS' });
    }
    return errors.length > 0
      ? this.finish(deliveryId, delivery.userId, invalidTokens, { status: 'FAILED', reason: 'PUSH_REJECTED' })
      : this.finish(deliveryId, delivery.userId, invalidTokens, { status: 'SKIPPED', reason: 'NO_DEVICE' });
  }

  private async sendSms(userId: string, text: string): Promise<boolean> {
    const { sms, phones } = this.deps;
    if (sms === undefined || phones === undefined) return false;
    const to = await phones.findPhoneNumber(userId);
    if (to === null) return false;
    await sms.send({ to, text });
    return true;
  }

  private async finish(
    deliveryId: string,
    userId: string,
    invalidTokens: readonly string[],
    outcome:
      | { readonly status: 'SENT'; readonly channel: DeliveryChannel }
      | { readonly status: 'SKIPPED' | 'FAILED'; readonly reason: DeliverySkipReason },
    pushedDevices = 0,
  ): Promise<SendNotificationOutcome> {
    const { store, clock } = this.deps;
    const { removedDevices, completed } = await this.inTx(async (tx) => ({
      removedDevices: await store.deleteDeviceTokens(tx, userId, invalidTokens),
      completed: await store.completeDelivery(tx, deliveryId, outcome, clock.now()),
    }));
    if (!completed) {
      // Bị huỷ / job khác chốt trong lúc gửi — trạng thái hiện tại thắng.
      const current = await this.inTx((tx) => store.findDelivery(tx, deliveryId));
      return { kind: 'ALREADY_DONE', status: current?.status ?? 'CANCELLED' };
    }
    if (outcome.status === 'SENT') {
      return { kind: 'SENT', channel: outcome.channel, pushedDevices, removedDevices };
    }
    return { kind: outcome.status, reason: outcome.reason, removedDevices };
  }
}
