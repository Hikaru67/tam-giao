import { fail, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import { DataExport } from '../../domain/data-export.js';
import type { UserId } from '../../domain/user.js';
import { toDataExportView, type DataExportView } from '../data-export-view.js';
import type { DataExportLinkSigner, DataExportRepository } from '../ports/data-rights.js';
import type { UserRepository } from '../ports/user-repository.js';

export interface RequestDataExportDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly users: UserRepository;
  readonly dataExports: DataExportRepository;
  readonly signer: DataExportLinkSigner;
}

export interface RequestDataExportResult {
  readonly view: DataExportView;
  /** `false` = trả lại yêu cầu đang dựng có sẵn (idempotent). */
  readonly created: boolean;
}

/**
 * Yêu cầu xuất dữ liệu cá nhân (BE-S7-06). Mỗi người tối đa một yêu cầu đang dựng (`PENDING`): đã có → trả lại yêu cầu
 * đó; hai request đồng thời → partial unique index cho đúng một bản ghi (A10). Tạo mới → `DataExportRequested` qua
 * outbox, worker dựng file (`BuildDataExport`).
 */
export class RequestDataExport {
  constructor(private readonly deps: RequestDataExportDeps) {}

  async execute(cmd: {
    readonly userId: string;
  }): Promise<Result<RequestDataExportResult, DomainError<'UNAUTHENTICATED'>>> {
    const { uow, clock, users, dataExports, signer } = this.deps;
    const now = clock.now();
    return uow.run(async (tx) => {
      if (!(await users.findActiveById(tx, cmd.userId as UserId))) return fail('UNAUTHENTICATED');
      const existing = await dataExports.findPendingByUser(tx, cmd.userId);
      if (existing) return ok({ view: toDataExportView(existing, now, signer), created: false });

      const exp = DataExport.request(cmd.userId, now);
      if (await dataExports.insert(tx, exp)) {
        return ok({ view: toDataExportView(exp, now, signer), created: true });
      }
      // Thua đua với request đồng thời: bản ghi kia đã commit trước câu INSERT này.
      const winner = await dataExports.findPendingByUser(tx, cmd.userId);
      if (!winner) throw new Error('data_exports: xung đột PENDING nhưng không đọc lại được bản ghi');
      return ok({ view: toDataExportView(winner, now, signer), created: false });
    });
  }
}
