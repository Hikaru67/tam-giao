import type { Tx } from '@tamgiao/kernel';
import type { NotificationPreferences } from '../../domain/templates.js';

export type DevicePlatformName = 'ios' | 'android';

export interface DeviceView {
  readonly deviceId: string;
  readonly platform: DevicePlatformName;
  readonly registeredAt: Date;
}

/**
 * Lưu thiết bị + cài đặt nhận thông báo (`notification.devices`, `notification.preferences`). Module mỏng (A11): port chỉ
 * để presentation/application không phụ thuộc infrastructure (A1).
 */
export interface NotificationSettingsStore {
  /** Ghi token (unique): token đã có → cập nhật chủ sở hữu/platform/`last_seen_at`, giữ `id`. */
  upsertDevice(
    tx: Tx,
    input: {
      readonly id: string;
      readonly userId: string;
      readonly token: string;
      readonly platform: DevicePlatformName;
      readonly now: Date;
    },
  ): Promise<DeviceView>;
  /** Xoá thiết bị của chính người dùng; `false` nếu không có. */
  removeDevice(tx: Tx, input: { readonly userId: string; readonly deviceId: string }): Promise<boolean>;
  findPreferences(tx: Tx, userId: string): Promise<NotificationPreferences | null>;
  savePreferences(tx: Tx, userId: string, prefs: NotificationPreferences, now: Date): Promise<void>;
}
