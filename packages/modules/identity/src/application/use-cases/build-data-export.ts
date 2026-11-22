import type { Clock, Tx } from '@tamgiao/kernel';
import type { DataExportId } from '../../domain/data-export.js';
import type { DataExportPayload, DataExportRepository, PersonalDataSource } from '../ports/data-rights.js';

export interface BuildDataExportDeps {
  readonly clock: Clock;
  readonly dataExports: DataExportRepository;
  /** Nguồn dữ liệu của từng module (identity + các module khác, composition root của worker truyền vào). */
  readonly sources: readonly PersonalDataSource[];
}

export type BuildDataExportOutcome = 'BUILT' | 'NOT_FOUND' | 'ALREADY_BUILT';

/**
 * Dựng file xuất dữ liệu (consumer `DataExportRequested`, chạy trong transaction của `deliverOnce`): khoá yêu cầu
 * `FOR UPDATE` → gom dữ liệu **của chính chủ** từ mọi `PersonalDataSource` (cùng `tx`, một snapshot) → lưu mã hoá +
 * `READY` (hạn tải `DATA_EXPORT_TTL_HOURS`). Idempotent (A9): không còn `PENDING` (đã dựng / bị xoá vì xoá tài khoản) →
 * no-op. Nguồn nào lỗi → throw, rollback, hàng đợi thử lại.
 */
export class BuildDataExport {
  constructor(private readonly deps: BuildDataExportDeps) {}

  async handle(tx: Tx, cmd: { readonly exportId: string }): Promise<BuildDataExportOutcome> {
    const { clock, dataExports, sources } = this.deps;
    const exp = await dataExports.findByIdForUpdate(tx, cmd.exportId as DataExportId);
    if (!exp) return 'NOT_FOUND';
    if (exp.status !== 'PENDING') return 'ALREADY_BUILT';

    const sections: Record<string, unknown> = {};
    const files: DataExportPayload['files'][number][] = [];
    for (const source of sources) {
      const section = await source.collect(tx, exp.userId);
      sections[source.section] = section.data;
      for (const file of section.files) files.push({ ...file, section: source.section });
    }
    const now = clock.now();
    exp.markReady(now);
    await dataExports.saveReady(tx, exp, { generatedAt: now.toISOString(), sections, files });
    return 'BUILT';
  }
}
