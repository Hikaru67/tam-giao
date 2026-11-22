import { ok, type Clock, type UnitOfWork } from '@tamgiao/kernel';
import type { DataExportRepository } from '../ports/data-rights.js';

export interface PurgeExpiredDataExportsDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly dataExports: DataExportRepository;
}

/**
 * Job định kỳ (BE-S7-06): xoá nội dung các file xuất dữ liệu đã quá hạn tải — không giữ bản sao dữ liệu cá nhân lâu hơn
 * cần thiết. Idempotent: file đã xoá nội dung không bị chọn lại. Trả số file vừa xoá.
 */
export class PurgeExpiredDataExports {
  constructor(private readonly deps: PurgeExpiredDataExportsDeps) {}

  async execute(): Promise<number> {
    const now = this.deps.clock.now();
    const purged = await this.deps.uow.run(async (tx) => ok(await this.deps.dataExports.purgeExpired(tx, now)));
    return purged.unwrapOr(0);
  }
}
