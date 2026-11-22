import {
  err,
  fail,
  ok,
  parseId,
  type Clock,
  type DomainError,
  type ObjectStorage,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { DataExportId } from '../../domain/data-export.js';
import type {
  DataExportLinkSigner,
  DataExportPayload,
  DataExportRepository,
} from '../ports/data-rights.js';

export interface DataExportDocument {
  readonly exportId: string;
  readonly userId: string;
  readonly generatedAt: string;
  readonly sections: Readonly<Record<string, unknown>>;
  readonly files: readonly {
    readonly section: string;
    readonly label: string;
    readonly url: string;
    readonly expiresAt: Date;
  }[];
}

export type DownloadDataExportError = DomainError<
  'INVALID_ID' | 'NOT_FOUND' | 'DATA_EXPORT_LINK_INVALID' | 'DATA_EXPORT_NOT_READY' | 'DATA_EXPORT_EXPIRED'
>;

export interface DownloadDataExportDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly dataExports: DataExportRepository;
  readonly signer: DataExportLinkSigner;
  readonly storage: ObjectStorage;
}

/**
 * Tải file xuất dữ liệu qua liên kết có ký (BE-S7-06) — không cần đăng nhập, dùng được tới hạn của file
 * (`DATA_EXPORT_TTL_HOURS`). Thứ tự: id sai → `INVALID_ID`; chữ ký sai → `DATA_EXPORT_LINK_INVALID` (không tra DB);
 * không có → `NOT_FOUND`; `expires` không đúng hạn của file → `DATA_EXPORT_LINK_INVALID`; chưa xong / quá hạn →
 * `DATA_EXPORT_NOT_READY` / `DATA_EXPORT_EXPIRED`. Ảnh của chính chủ trả presigned GET cấp tại lúc tải (hạn ngắn
 * `PRESIGNED_URL_TTL_SECONDS`, AGENTS.md mục 5), không nhúng URL dài hạn vào file.
 */
export class DownloadDataExport {
  constructor(private readonly deps: DownloadDataExportDeps) {}

  async execute(cmd: {
    readonly exportId: string;
    readonly expires: number;
    readonly signature: string;
  }): Promise<Result<DataExportDocument, DownloadDataExportError>> {
    const id = parseId<'DataExport'>(cmd.exportId);
    if (id.isErr()) return fail('INVALID_ID');
    const { uow, clock, dataExports, signer, storage } = this.deps;
    if (!signer.verify(id.value, cmd.expires, cmd.signature)) return fail('DATA_EXPORT_LINK_INVALID');
    const now = clock.now();

    const loaded = await uow.run<
      { readonly userId: string; readonly payload: DataExportPayload },
      DownloadDataExportError
    >(async (tx) => {
      const exp = await dataExports.findById(tx, id.value as DataExportId);
      if (!exp) return fail('NOT_FOUND');
      const expiresAt = exp.toState().expiresAt;
      if (expiresAt !== null && Math.floor(expiresAt.getTime() / 1_000) !== cmd.expires) {
        return fail('DATA_EXPORT_LINK_INVALID');
      }
      const downloadable = exp.checkDownloadable(now);
      if (downloadable.isErr()) return err(downloadable.error);
      const payload = await dataExports.loadPayload(tx, exp);
      if (!payload) return fail('DATA_EXPORT_EXPIRED');
      return ok({ userId: exp.userId, payload });
    });
    if (loaded.isErr()) return err(loaded.error);

    const { userId, payload } = loaded.value;
    const files = await Promise.all(
      payload.files.map(async (f) => {
        const signed = await storage.presignGet({ bucket: f.bucket, key: f.key });
        return { section: f.section, label: f.label, url: signed.url, expiresAt: signed.expiresAt };
      }),
    );
    return ok({
      exportId: id.value,
      userId,
      generatedAt: payload.generatedAt,
      sections: payload.sections,
      files,
    });
  }
}
