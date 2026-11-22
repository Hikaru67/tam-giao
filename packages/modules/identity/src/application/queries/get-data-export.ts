import {
  fail,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { DataExportId } from '../../domain/data-export.js';
import { toDataExportView, type DataExportView } from '../data-export-view.js';
import type { DataExportLinkSigner, DataExportRepository } from '../ports/data-rights.js';

export interface GetDataExportDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly dataExports: DataExportRepository;
  readonly signer: DataExportLinkSigner;
}

/** Trạng thái một yêu cầu xuất dữ liệu của chính người xem (của người khác → `NOT_FOUND`, không lộ là có tồn tại). */
export class GetDataExport {
  constructor(private readonly deps: GetDataExportDeps) {}

  async execute(cmd: {
    readonly userId: string;
    readonly exportId: string;
  }): Promise<Result<DataExportView, DomainError<'INVALID_ID' | 'NOT_FOUND'>>> {
    const id = parseId<'DataExport'>(cmd.exportId);
    if (id.isErr()) return fail('INVALID_ID');
    const { uow, clock, dataExports, signer } = this.deps;
    return uow.run(async (tx) => {
      const exp = await dataExports.findById(tx, id.value as DataExportId);
      if (!exp || exp.userId !== cmd.userId) return fail('NOT_FOUND');
      return ok(toDataExportView(exp, clock.now(), signer));
    });
  }
}
