import type { AppEnv } from '@tamgiao/http';
import type { Clock, Scheduler, UnitOfWork } from '@tamgiao/kernel';
import type { EventBus } from '@tamgiao/db';
import type { Hono, MiddlewareHandler } from 'hono';
import {
  GetNotificationSettings,
  RegisterDevice,
  UnregisterDevice,
  UpdateNotificationSettings,
} from './application/notification-settings.js';
import type { PushSender } from './application/ports/push-sender.js';
import type { PhoneDirectory, SmsSender } from './application/ports/sms.js';
import { DrizzleNotificationStore } from './infrastructure/drizzle-notification-store.js';
import { registerNotificationConsumers } from './infrastructure/notification-consumers.js';
import { SendNotification } from './infrastructure/send-notification.js';
import { createNotificationRoutes } from './presentation/notification-routes.js';

/**
 * Module notification (BE-S7-05, module mỏng — A11): push qua Expo + SMS thay thế + template tiếng Việt theo event.
 * API: đăng ký thiết bị, cài đặt nhận thông báo. Worker: consumer event → `notification.deliveries` (+ job gửi hẹn giờ),
 * job `notification.send` gửi từng thông báo.
 */

export type { PushMessage, PushOutcome, PushSender } from './application/ports/push-sender.js';
export type { PhoneDirectory, SmsMessage, SmsSender } from './application/ports/sms.js';
export {
  NOTIFICATION_KINDS,
  NOTIFICATION_CATEGORIES,
  templateFor,
  type NotificationCategory,
  type NotificationKind,
  type NotificationTemplate,
} from './domain/templates.js';
export {
  ExpoPushError,
  ExpoPushSender,
  type ExpoPushSenderOptions,
} from './infrastructure/expo-push-sender.js';
export { FakePushSender } from './infrastructure/fake-push-sender.js';
export {
  DATE_CANCELLED_EVENT,
  DATE_CONFIRMED_EVENT,
  DATE_PROPOSED_EVENT,
  NOTIFICATION_CONSUMERS,
  NOTIFICATION_SEND_QUEUE,
} from './infrastructure/notification-consumers.js';
export {
  PushTemporarilyFailedError,
  type SendNotification,
  type SendNotificationOutcome,
} from './infrastructure/send-notification.js';

export interface NotificationWorkerDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  /** Hẹn job `notification.send` cùng transaction consumer (`PgBossScheduler`). */
  readonly scheduler: Scheduler;
  readonly push: PushSender;
  /** SMS thay thế cho thông báo giao dịch (adapter của identity, D4). Cần cả `phones` mới gửi được. */
  readonly sms?: SmsSender;
  readonly phones?: PhoneDirectory;
}

export interface NotificationWorker {
  /** Đăng ký consumer event → thông báo (worker gọi trước `registerConsumers`). */
  registerConsumers(bus: EventBus): void;
  /** Use case của job `notification.send`. */
  readonly sendNotification: SendNotification;
}

/** Phần worker của module notification. */
export function createNotificationWorker(deps: NotificationWorkerDeps): NotificationWorker {
  const store = new DrizzleNotificationStore();
  const sendNotification = new SendNotification({
    uow: deps.uow,
    clock: deps.clock,
    store,
    push: deps.push,
    ...(deps.sms === undefined ? {} : { sms: deps.sms }),
    ...(deps.phones === undefined ? {} : { phones: deps.phones }),
  });
  return {
    registerConsumers: (bus) =>
      registerNotificationConsumers(bus, { clock: deps.clock, store, scheduler: deps.scheduler }),
    sendNotification,
  };
}

export interface NotificationModuleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly requireUser: MiddlewareHandler<AppEnv>;
}

export interface NotificationModule {
  readonly name: 'notification';
  /** `POST /me/devices`, `DELETE /me/devices/:deviceId`, `GET|PUT /me/notification-settings`. */
  readonly routes: Hono<AppEnv>;
}

/** Composition root phía API của module notification. */
export function createNotificationModule(deps: NotificationModuleDeps): NotificationModule {
  const settings = { uow: deps.uow, clock: deps.clock, store: new DrizzleNotificationStore() };
  const routes = createNotificationRoutes({
    registerDevice: new RegisterDevice(settings),
    unregisterDevice: new UnregisterDevice(settings),
    getSettings: new GetNotificationSettings(settings),
    updateSettings: new UpdateNotificationSettings(settings),
    requireUser: deps.requireUser,
  });
  return { name: 'notification', routes };
}
