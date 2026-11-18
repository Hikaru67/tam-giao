import {
  err,
  ok,
  type Clock,
  type DomainError,
  type Result,
  type Tx,
  type UnitOfWork,
} from '@tamgiao/kernel';
import { AuditEntry } from '../../domain/audit-entry.js';
import type { AuditLogger, AuditLogInput } from '../facade.js';
import type { AuditLogRepository } from '../ports/audit-log-repository.js';

export interface RecordAuditEntryDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly auditLogs: AuditLogRepository;
}

/** Hiện thực `AuditLogger` cho mọi module (BE-S2-04). */
export class RecordAuditEntry implements AuditLogger {
  constructor(private readonly deps: RecordAuditEntryDeps) {}

  log(entry: AuditLogInput): Promise<Result<void, DomainError>>;
  log(tx: Tx, entry: AuditLogInput): Promise<Result<void, DomainError>>;
  async log(txOrEntry: Tx | AuditLogInput, maybeEntry?: AuditLogInput): Promise<Result<void, DomainError>> {
    if (maybeEntry !== undefined) return this.append(txOrEntry as Tx, maybeEntry);
    return this.deps.uow.run((tx) => this.append(tx, txOrEntry as AuditLogInput));
  }

  private async append(tx: Tx, input: AuditLogInput): Promise<Result<void, DomainError>> {
    const entry = AuditEntry.create(input, this.deps.clock.now());
    if (entry.isErr()) return err(entry.error);
    await this.deps.auditLogs.append(tx, entry.value);
    return ok();
  }
}
