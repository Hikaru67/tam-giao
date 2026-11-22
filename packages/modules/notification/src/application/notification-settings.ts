import {
  err,
  newId,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import {
  ALWAYS_ON_CATEGORIES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationCategory,
  type NotificationPreferences,
} from '../domain/templates.js';
import type {
  DevicePlatformName,
  DeviceView,
  NotificationSettingsStore,
} from './ports/notification-settings-store.js';

export interface NotificationSettingsDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly store: NotificationSettingsStore;
}

/** `POST /me/devices`: đăng ký / làm mới push token của thiết bị (token đã thuộc người khác → chuyển sang người này). */
export class RegisterDevice {
  constructor(private readonly deps: NotificationSettingsDeps) {}

  async execute(cmd: {
    readonly userId: string;
    readonly token: string;
    readonly platform: DevicePlatformName;
  }): Promise<Result<DeviceView, DomainError>> {
    const { uow, clock, store } = this.deps;
    return uow.run(async (tx) => ok(await store.upsertDevice(tx, { id: newId(), ...cmd, now: clock.now() })));
  }
}

/** `DELETE /me/devices/:deviceId` (đăng xuất / tắt push trên máy). Idempotent: không có cũng coi như đã xoá. */
export class UnregisterDevice {
  constructor(private readonly deps: Pick<NotificationSettingsDeps, 'uow' | 'store'>) {}

  async execute(cmd: {
    readonly userId: string;
    readonly deviceId: string;
  }): Promise<Result<void, DomainError>> {
    const deviceId = parseId(cmd.deviceId);
    if (deviceId.isErr()) return err(deviceId.error);
    return this.deps.uow.run(async (tx) => {
      await this.deps.store.removeDevice(tx, { userId: cmd.userId, deviceId: deviceId.value });
      return ok(undefined);
    });
  }
}

export interface NotificationSettingsView extends NotificationPreferences {
  readonly alwaysOn: readonly NotificationCategory[];
}

const toView = (prefs: NotificationPreferences): NotificationSettingsView => ({
  matches: prefs.matches,
  messages: prefs.messages,
  dates: prefs.dates,
  alwaysOn: ALWAYS_ON_CATEGORIES,
});

export class GetNotificationSettings {
  constructor(private readonly deps: Pick<NotificationSettingsDeps, 'uow' | 'store'>) {}

  async execute(userId: string): Promise<Result<NotificationSettingsView, DomainError>> {
    return this.deps.uow.run(async (tx) =>
      ok(toView((await this.deps.store.findPreferences(tx, userId)) ?? DEFAULT_NOTIFICATION_PREFERENCES)),
    );
  }
}

export class UpdateNotificationSettings {
  constructor(private readonly deps: NotificationSettingsDeps) {}

  async execute(cmd: {
    readonly userId: string;
    readonly preferences: NotificationPreferences;
  }): Promise<Result<NotificationSettingsView, DomainError>> {
    const { uow, clock, store } = this.deps;
    return uow.run(async (tx) => {
      await store.savePreferences(tx, cmd.userId, cmd.preferences, clock.now());
      return ok(toView(cmd.preferences));
    });
  }
}
