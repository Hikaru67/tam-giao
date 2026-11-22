import { DATA_EXPORT_REQUESTED } from '@tamgiao/contracts';
import { asDbTx, type EventBus } from '@tamgiao/db';
import type { DomainEvent, Encryptor, Tx } from '@tamgiao/kernel';
import { asc, eq } from 'drizzle-orm';
import type { PersonalDataSection, PersonalDataSource } from '../application/ports/data-rights.js';
import type { BuildDataExport } from '../application/use-cases/build-data-export.js';
import { sessions, users } from './schema.js';

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const IDENTITY_BUILD_DATA_EXPORT_CONSUMER = 'identity.build-data-export';

function exportIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const exportId = (payload as { exportId?: unknown }).exportId;
    if (typeof exportId === 'string' && exportId.length > 0) return exportId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu exportId`);
}

/** `DataExportRequested` → dựng file xuất dữ liệu (BE-S7-06). Chạy trong tx của `deliverOnce`. */
export function registerDataExportConsumer(bus: EventBus, buildDataExport: BuildDataExport): void {
  bus.on(DATA_EXPORT_REQUESTED, IDENTITY_BUILD_DATA_EXPORT_CONSUMER, async (event, tx) => {
    await buildDataExport.handle(tx, { exportId: exportIdOf(event) });
  });
}

/**
 * Mục `account` của file xuất (BE-S7-06): SĐT (giải mã), ngày tạo tài khoản, danh sách thiết bị đăng nhập. Không gồm
 * audit log (nhật ký thao tác của hệ thống, chỉ ghi thêm).
 */
export function createIdentityPersonalDataSource(encryptor: Encryptor): PersonalDataSource {
  return {
    section: 'account',
    async collect(tx: Tx, userId: string): Promise<PersonalDataSection> {
      const db = asDbTx(tx);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return { data: null, files: [] };
      const phone =
        user.deletedAt === null
          ? await encryptor.decrypt(user.phoneEnc, `identity.users.phone:${user.id}`)
          : null;
      const devices = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(asc(sessions.createdAt));
      return {
        data: {
          userId: user.id,
          phone,
          createdAt: user.createdAt.toISOString(),
          sessions: devices.map((s) => ({
            deviceName: s.deviceName,
            createdAt: s.createdAt.toISOString(),
            lastUsedAt: s.lastUsedAt.toISOString(),
            revokedAt: s.revokedAt?.toISOString() ?? null,
          })),
        },
        files: [],
      };
    },
  };
}
