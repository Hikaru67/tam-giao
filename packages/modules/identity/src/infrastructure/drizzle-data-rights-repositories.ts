import { asDbTx, processedEvents, type OutboxWriter } from '@tamgiao/db';
import type { Encryptor, Tx } from '@tamgiao/kernel';
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type {
  AccountDeletionRepository,
  ConsumerProgressReader,
  DataExportPayload,
  DataExportRepository,
} from '../application/ports/data-rights.js';
import { AccountDeletion, type AccountDeletionId } from '../domain/account-deletion.js';
import { DataExport, type DataExportId, type DataExportStoredStatus } from '../domain/data-export.js';
import { accountDeletions, dataExports } from './schema.js';

const payloadContext = (exportId: string) => `identity.data_exports.payload:${exportId}`;

type DataExportRow = typeof dataExports.$inferSelect;

const toDataExport = (row: DataExportRow): DataExport =>
  DataExport.restore({
    id: row.id as DataExportId,
    userId: row.userId,
    status: row.status as DataExportStoredStatus,
    requestedAt: row.requestedAt,
    readyAt: row.readyAt,
    expiresAt: row.expiresAt,
    version: row.version,
  });

/** `DataExportRepository` trên `identity.data_exports`; nội dung file mã hoá qua `Encryptor`. */
export class DrizzleDataExportRepository implements DataExportRepository {
  constructor(
    private readonly encryptor: Encryptor,
    private readonly outbox: OutboxWriter,
  ) {}

  async insert(tx: Tx, exp: DataExport): Promise<boolean> {
    const s = exp.toState();
    // Không chỉ định target → bỏ qua vi phạm mọi unique (ở đây chỉ có partial index PENDING / người dùng).
    const inserted = await asDbTx(tx)
      .insert(dataExports)
      .values({
        id: s.id,
        userId: s.userId,
        status: s.status,
        requestedAt: s.requestedAt,
        readyAt: s.readyAt,
        expiresAt: s.expiresAt,
        payloadEnc: null,
        version: s.version,
      })
      .onConflictDoNothing()
      .returning({ id: dataExports.id });
    if (inserted.length === 0) return false;
    await this.outbox.append(tx, exp.pullEvents());
    return true;
  }

  async findById(tx: Tx, id: DataExportId): Promise<DataExport | null> {
    const [row] = await asDbTx(tx).select().from(dataExports).where(eq(dataExports.id, id));
    return row ? toDataExport(row) : null;
  }

  async findByIdForUpdate(tx: Tx, id: DataExportId): Promise<DataExport | null> {
    const [row] = await asDbTx(tx).select().from(dataExports).where(eq(dataExports.id, id)).for('update');
    return row ? toDataExport(row) : null;
  }

  async findPendingByUser(tx: Tx, userId: string): Promise<DataExport | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(dataExports)
      .where(and(eq(dataExports.userId, userId), eq(dataExports.status, 'PENDING')));
    return row ? toDataExport(row) : null;
  }

  async saveReady(tx: Tx, exp: DataExport, payload: DataExportPayload): Promise<void> {
    const s = exp.toState();
    const payloadEnc = await this.encryptor.encrypt(JSON.stringify(payload), payloadContext(s.id));
    await asDbTx(tx)
      .update(dataExports)
      .set({ status: s.status, readyAt: s.readyAt, expiresAt: s.expiresAt, payloadEnc, version: s.version })
      .where(eq(dataExports.id, s.id));
  }

  async loadPayload(tx: Tx, exp: DataExport): Promise<DataExportPayload | null> {
    const [row] = await asDbTx(tx)
      .select({ payloadEnc: dataExports.payloadEnc })
      .from(dataExports)
      .where(eq(dataExports.id, exp.id));
    if (!row?.payloadEnc) return null;
    return JSON.parse(await this.encryptor.decrypt(row.payloadEnc, payloadContext(exp.id))) as DataExportPayload;
  }

  async purgeExpired(tx: Tx, now: Date): Promise<number> {
    const purged = await asDbTx(tx)
      .update(dataExports)
      .set({ payloadEnc: null })
      .where(and(isNotNull(dataExports.payloadEnc), lte(dataExports.expiresAt, now)))
      .returning({ id: dataExports.id });
    return purged.length;
  }

  async deleteByUser(tx: Tx, userId: string): Promise<void> {
    await asDbTx(tx).delete(dataExports).where(eq(dataExports.userId, userId));
  }
}

type AccountDeletionRow = typeof accountDeletions.$inferSelect;

const toAccountDeletion = (row: AccountDeletionRow): AccountDeletion =>
  AccountDeletion.restore({
    id: row.id as AccountDeletionId,
    userId: row.userId,
    requestedAt: row.requestedAt,
    eventId: row.eventId,
    version: row.version,
  });

/** `AccountDeletionRepository` trên `identity.account_deletions` (unique `user_id`). */
export class DrizzleAccountDeletionRepository implements AccountDeletionRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async findById(tx: Tx, id: AccountDeletionId): Promise<AccountDeletion | null> {
    const [row] = await asDbTx(tx).select().from(accountDeletions).where(eq(accountDeletions.id, id));
    return row ? toAccountDeletion(row) : null;
  }

  async findByUser(tx: Tx, userId: string): Promise<AccountDeletion | null> {
    const [row] = await asDbTx(tx).select().from(accountDeletions).where(eq(accountDeletions.userId, userId));
    return row ? toAccountDeletion(row) : null;
  }

  async insert(tx: Tx, deletion: AccountDeletion): Promise<void> {
    const s = deletion.toState();
    await asDbTx(tx).insert(accountDeletions).values({
      id: s.id,
      userId: s.userId,
      eventId: s.eventId,
      requestedAt: s.requestedAt,
      version: s.version,
    });
    await this.outbox.append(tx, deletion.pullEvents());
  }
}

/** Đọc `platform.processed_events` (bảng hạ tầng dùng chung, không thuộc module nào). */
export class DrizzleConsumerProgressReader implements ConsumerProgressReader {
  async processedConsumers(tx: Tx, eventId: string, consumers: readonly string[]): Promise<ReadonlySet<string>> {
    if (consumers.length === 0) return new Set();
    const rows = await asDbTx(tx)
      .select({ consumer: processedEvents.consumer })
      .from(processedEvents)
      .where(and(eq(processedEvents.eventId, eventId), inArray(processedEvents.consumer, [...consumers])));
    return new Set(rows.map((r) => r.consumer));
  }
}
