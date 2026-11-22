import type { DataExport, DataExportStatus } from '../domain/data-export.js';
import type { DataExportLinkSigner } from './ports/data-rights.js';

export interface DataExportView {
  readonly exportId: string;
  readonly status: DataExportStatus;
  readonly requestedAt: Date;
  readonly readyAt: Date | null;
  readonly expiresAt: Date | null;
  /** Đường dẫn tải có ký (tương đối với gốc API); chỉ có khi `READY` và chưa hết hạn. */
  readonly downloadUrl: string | null;
}

/** Đường dẫn tải: `/data-exports/:id/download?expires=<epoch giây>&sig=<HMAC>` — hết hạn cùng file. */
export function dataExportDownloadPath(exportId: string, expiresAt: Date, signer: DataExportLinkSigner): string {
  const expires = Math.floor(expiresAt.getTime() / 1_000);
  return `/data-exports/${exportId}/download?expires=${expires}&sig=${signer.sign(exportId, expires)}`;
}

export function toDataExportView(exp: DataExport, now: Date, signer: DataExportLinkSigner): DataExportView {
  const s = exp.toState();
  const status = exp.statusAt(now);
  return {
    exportId: s.id,
    status,
    requestedAt: s.requestedAt,
    readyAt: s.readyAt,
    expiresAt: s.expiresAt,
    downloadUrl:
      status === 'READY' && s.expiresAt !== null ? dataExportDownloadPath(s.id, s.expiresAt, signer) : null,
  };
}
