import { ok, type DomainEvent, type ObjectStorage, type Result, type Tx } from '@tamgiao/kernel';
import type { AuditLogger, AuditLogInput } from '../application/facade.js';
import type {
  AccountDeletionRepository,
  ConsumerProgressReader,
  DataExportLinkSigner,
  DataExportPayload,
  DataExportRepository,
} from '../application/ports/data-rights.js';
import {
  AccountDeletion,
  type AccountDeletionId,
  type AccountDeletionState,
} from '../domain/account-deletion.js';
import { DataExport, type DataExportId, type DataExportState } from '../domain/data-export.js';
import { MemoryTable } from './fakes.js';

/** `DataExportRepository` in-memory (BE-S7-06); `events` = outbox giả. */
export class InMemoryDataExportRepository implements DataExportRepository {
  readonly table = new MemoryTable<DataExportState>();
  readonly payloads = new MemoryTable<DataExportPayload>();
  readonly events = new MemoryTable<DomainEvent>();

  async insert(_tx: Tx, exp: DataExport): Promise<boolean> {
    const s = exp.toState();
    if ([...this.table.rows.values()].some((r) => r.userId === s.userId && r.status === 'PENDING')) return false;
    this.table.rows.set(s.id, s);
    for (const e of exp.pullEvents()) this.events.rows.set(e.eventId, e);
    return true;
  }
  async findById(_tx: Tx, id: DataExportId): Promise<DataExport | null> {
    const s = this.table.rows.get(id);
    return s ? DataExport.restore(s) : null;
  }
  findByIdForUpdate(tx: Tx, id: DataExportId): Promise<DataExport | null> {
    return this.findById(tx, id);
  }
  async findPendingByUser(_tx: Tx, userId: string): Promise<DataExport | null> {
    const s = [...this.table.rows.values()].find((r) => r.userId === userId && r.status === 'PENDING');
    return s ? DataExport.restore(s) : null;
  }
  async saveReady(_tx: Tx, exp: DataExport, payload: DataExportPayload): Promise<void> {
    this.table.rows.set(exp.id, exp.toState());
    this.payloads.rows.set(exp.id, payload);
  }
  async loadPayload(_tx: Tx, exp: DataExport): Promise<DataExportPayload | null> {
    return this.payloads.rows.get(exp.id) ?? null;
  }
  async purgeExpired(_tx: Tx, now: Date): Promise<number> {
    let n = 0;
    for (const [id, s] of this.table.rows) {
      if (s.expiresAt !== null && s.expiresAt <= now && this.payloads.rows.delete(id)) n++;
    }
    return n;
  }
  async deleteByUser(_tx: Tx, userId: string): Promise<void> {
    for (const [id, s] of this.table.rows) {
      if (s.userId === userId) {
        this.table.rows.delete(id);
        this.payloads.rows.delete(id);
      }
    }
  }
}

export class InMemoryAccountDeletionRepository implements AccountDeletionRepository {
  readonly table = new MemoryTable<AccountDeletionState>();
  readonly events = new MemoryTable<DomainEvent>();

  async findById(_tx: Tx, id: AccountDeletionId): Promise<AccountDeletion | null> {
    const s = this.table.rows.get(id);
    return s ? AccountDeletion.restore(s) : null;
  }
  async findByUser(_tx: Tx, userId: string): Promise<AccountDeletion | null> {
    const s = [...this.table.rows.values()].find((r) => r.userId === userId);
    return s ? AccountDeletion.restore(s) : null;
  }
  async insert(_tx: Tx, deletion: AccountDeletion): Promise<void> {
    const s = deletion.toState();
    if ([...this.table.rows.values()].some((r) => r.userId === s.userId)) {
      throw new Error('duplicate key value violates unique constraint "account_deletions_user_id_uq"');
    }
    this.table.rows.set(s.id, s);
    for (const e of deletion.pullEvents()) this.events.rows.set(e.eventId, e);
  }
}

/** `processed`: các cặp `consumer|eventId` đã xử lý. */
export class FakeConsumerProgressReader implements ConsumerProgressReader {
  readonly processed = new Set<string>();
  async processedConsumers(_tx: Tx, eventId: string, consumers: readonly string[]): Promise<ReadonlySet<string>> {
    return new Set(consumers.filter((c) => this.processed.has(`${c}|${eventId}`)));
  }
}

export class FakeLinkSigner implements DataExportLinkSigner {
  sign(exportId: string, expires: number): string {
    return `sig-${exportId}-${expires}`.replaceAll(/[^A-Za-z0-9_-]/g, '');
  }
  verify(exportId: string, expires: number, signature: string): boolean {
    return this.sign(exportId, expires) === signature;
  }
}

export class RecordingAuditLogger implements AuditLogger {
  readonly entries: AuditLogInput[] = [];
  log(entry: AuditLogInput): Promise<Result<void, never>>;
  log(tx: Tx, entry: AuditLogInput): Promise<Result<void, never>>;
  async log(a: Tx | AuditLogInput, b?: AuditLogInput): Promise<Result<void, never>> {
    this.entries.push((b ?? a) as AuditLogInput);
    return ok();
  }
}

/** `ObjectStorage` giả: presigned GET trả URL đoán được, ghi lại key đã xoá. */
export class FakeObjectStorage implements ObjectStorage {
  readonly deleted: string[] = [];
  constructor(private readonly now: () => Date) {}
  async presignPut(): Promise<never> {
    throw new Error('không dùng');
  }
  async presignGet(input: { readonly bucket: string; readonly key: string }) {
    return {
      url: `https://storage.test/${input.bucket}/${input.key}?sig=x`,
      method: 'GET' as const,
      headers: {},
      expiresAt: new Date(this.now().getTime() + 300_000),
    };
  }
  async head(): Promise<null> {
    return null;
  }
  async delete(bucket: string, key: string): Promise<void> {
    this.deleted.push(`${bucket}/${key}`);
  }
}
