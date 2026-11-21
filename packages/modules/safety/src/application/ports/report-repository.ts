import type { Tx } from '@tamgiao/kernel';
import type { Report, ReportId } from '../../domain/report.js';

/** Lưu / tải aggregate `Report` (`safety.reports`). Mọi thao tác chạy trong `tx` của caller (A5). */
export interface ReportRepository {
  /**
   * Lưu báo cáo mới hoặc thay đổi + ghi event chờ phát vào outbox, cùng `tx` (A6). Kiểm tra version lạc quan
   * (bản trong DB phải đúng version trước các event chờ), lệch → throw. Không có event → no-op.
   */
  save(tx: Tx, report: Report): Promise<void>;

  findById(tx: Tx, id: ReportId): Promise<Report | null>;
}
