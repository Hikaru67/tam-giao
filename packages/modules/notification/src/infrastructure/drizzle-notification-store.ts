import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type {
  DevicePlatformName,
  DeviceView,
  NotificationSettingsStore,
} from '../application/ports/notification-settings-store.js';
import {
  isNotificationKind,
  type NotificationKind,
  type NotificationPreferences,
} from '../domain/templates.js';
import { deliveries, devices, preferences } from './schema.js';

export type DeliveryStatus = 'PENDING' | 'SENT' | 'SKIPPED' | 'FAILED' | 'CANCELLED';
export type DeliveryChannel = 'PUSH' | 'SMS';
/** `OPTED_OUT`: người dùng tắt nhóm; `NO_DEVICE`: không có thiết bị (và không gửi được SMS); `PUSH_REJECTED`: bị từ chối. */
export type DeliverySkipReason = 'OPTED_OUT' | 'NO_DEVICE' | 'PUSH_REJECTED';

export interface NewDelivery {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly kind: NotificationKind;
  readonly userId: string;
  readonly aggregateId: string;
  readonly data: Readonly<Record<string, string>>;
  readonly sendAfter: Date;
}

export interface Delivery extends NewDelivery {
  readonly status: DeliveryStatus;
}

export interface DeviceToken {
  readonly deviceId: string;
  readonly token: string;
}

type DeliveryRow = typeof deliveries.$inferSelect;

function toDelivery(r: DeliveryRow): Delivery {
  if (!isNotificationKind(r.kind)) throw new Error(`notification.deliveries ${r.id}: kind lạ "${r.kind}"`);
  return {
    id: r.id,
    eventId: r.eventId,
    eventType: r.eventType,
    kind: r.kind,
    userId: r.userId,
    aggregateId: r.aggregateId,
    data: r.data,
    sendAfter: r.sendAfter,
    status: r.status as DeliveryStatus,
  };
}

/**
 * Truy cập 3 bảng của schema `notification` trong `tx` của caller (A5). Module mỏng (A11): consumer/job gọi thẳng
 * store này; presentation đi qua port `NotificationSettingsStore`.
 */
export class DrizzleNotificationStore implements NotificationSettingsStore {
  async upsertDevice(
    tx: Tx,
    input: {
      readonly id: string;
      readonly userId: string;
      readonly token: string;
      readonly platform: DevicePlatformName;
      readonly now: Date;
    },
  ): Promise<DeviceView> {
    const [row] = await asDbTx(tx)
      .insert(devices)
      .values({
        id: input.id,
        userId: input.userId,
        token: input.token,
        platform: input.platform,
        createdAt: input.now,
        lastSeenAt: input.now,
      })
      .onConflictDoUpdate({
        target: devices.token,
        set: {
          userId: sql`excluded.user_id`,
          platform: sql`excluded.platform`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      })
      .returning();
    if (!row) throw new Error('notification.devices: UPSERT không trả dòng');
    return { deviceId: row.id, platform: row.platform as DevicePlatformName, registeredAt: row.createdAt };
  }

  async removeDevice(
    tx: Tx,
    input: { readonly userId: string; readonly deviceId: string },
  ): Promise<boolean> {
    const removed = await asDbTx(tx)
      .delete(devices)
      .where(and(eq(devices.id, input.deviceId), eq(devices.userId, input.userId)))
      .returning({ id: devices.id });
    return removed.length > 0;
  }

  async listDeviceTokens(tx: Tx, userId: string): Promise<DeviceToken[]> {
    const rows = await asDbTx(tx)
      .select({ deviceId: devices.id, token: devices.token })
      .from(devices)
      .where(eq(devices.userId, userId))
      .orderBy(devices.createdAt);
    return rows;
  }

  /** Xoá token hỏng — chỉ khi token còn thuộc đúng người (máy có thể đã chuyển chủ trong lúc gửi). */
  async deleteDeviceTokens(tx: Tx, userId: string, tokens: readonly string[]): Promise<number> {
    if (tokens.length === 0) return 0;
    const removed = await asDbTx(tx)
      .delete(devices)
      .where(and(eq(devices.userId, userId), inArray(devices.token, [...tokens])))
      .returning({ id: devices.id });
    return removed.length;
  }

  async findPreferences(tx: Tx, userId: string): Promise<NotificationPreferences | null> {
    const [row] = await asDbTx(tx).select().from(preferences).where(eq(preferences.userId, userId));
    return row ? { matches: row.matches, messages: row.messages, dates: row.dates } : null;
  }

  async savePreferences(tx: Tx, userId: string, prefs: NotificationPreferences, now: Date): Promise<void> {
    await asDbTx(tx)
      .insert(preferences)
      .values({ userId, ...prefs, updatedAt: now })
      .onConflictDoUpdate({
        target: preferences.userId,
        set: { matches: prefs.matches, messages: prefs.messages, dates: prefs.dates, updatedAt: now },
      });
  }

  /**
   * Thêm thông báo `PENDING`; trùng (`event_id`, `user_id`, `kind`) → bỏ qua. Trả các dòng **thực sự được thêm** (caller
   * chỉ hẹn job gửi cho các dòng này).
   */
  async insertDeliveries(tx: Tx, rows: readonly NewDelivery[], now: Date): Promise<NewDelivery[]> {
    if (rows.length === 0) return [];
    const inserted = await asDbTx(tx)
      .insert(deliveries)
      .values(
        rows.map((r) => ({
          ...r,
          data: { ...r.data },
          status: 'PENDING',
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing({ target: [deliveries.eventId, deliveries.userId, deliveries.kind] })
      .returning({ id: deliveries.id });
    const ids = new Set(inserted.map((r) => r.id));
    return rows.filter((r) => ids.has(r.id));
  }

  /** Huỷ thông báo `PENDING` (nhắc nhở) theo aggregate + loại, mọi người nhận. Trả số dòng đã huỷ. */
  async cancelPending(
    tx: Tx,
    input: {
      readonly aggregateId: string;
      readonly kind: NotificationKind;
      /** Event đang huỷ — thông báo do chính event này sinh ra không bị huỷ (handler chạy lại vẫn idempotent). */
      readonly exceptEventId: string;
      readonly now: Date;
    },
  ): Promise<number> {
    const cancelled = await asDbTx(tx)
      .update(deliveries)
      .set({ status: 'CANCELLED', updatedAt: input.now })
      .where(
        and(
          eq(deliveries.aggregateId, input.aggregateId),
          eq(deliveries.kind, input.kind),
          eq(deliveries.status, 'PENDING'),
          ne(deliveries.eventId, input.exceptEventId),
        ),
      )
      .returning({ id: deliveries.id });
    return cancelled.length;
  }

  async findDelivery(tx: Tx, id: string): Promise<Delivery | null> {
    const [row] = await asDbTx(tx).select().from(deliveries).where(eq(deliveries.id, id));
    return row ? toDelivery(row) : null;
  }

  /** `PENDING → SENT|SKIPPED|FAILED`; `false` nếu dòng không còn `PENDING` (đã xử lý / bị huỷ trong lúc gửi). */
  async completeDelivery(
    tx: Tx,
    id: string,
    outcome:
      | { readonly status: 'SENT'; readonly channel: DeliveryChannel }
      | { readonly status: 'SKIPPED' | 'FAILED'; readonly reason: DeliverySkipReason },
    now: Date,
  ): Promise<boolean> {
    const set =
      outcome.status === 'SENT'
        ? { status: 'SENT', channel: outcome.channel, sentAt: now, updatedAt: now }
        : { status: outcome.status, skipReason: outcome.reason, updatedAt: now };
    const updated = await asDbTx(tx)
      .update(deliveries)
      .set(set)
      .where(and(eq(deliveries.id, id), eq(deliveries.status, 'PENDING')))
      .returning({ id: deliveries.id });
    return updated.length > 0;
  }

  /** Người gửi báo cáo — tra từ thông báo `REPORT_RECEIVED` đã sinh khi xử lý `ReportFiled`. */
  async findReporterId(tx: Tx, reportId: string): Promise<string | null> {
    const [row] = await asDbTx(tx)
      .select({ userId: deliveries.userId })
      .from(deliveries)
      .where(and(eq(deliveries.aggregateId, reportId), eq(deliveries.kind, 'REPORT_RECEIVED')))
      .limit(1);
    return row?.userId ?? null;
  }
}
