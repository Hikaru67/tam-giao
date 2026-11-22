import {
  AggregateRoot,
  addDuration,
  fail,
  newId,
  ok,
  type DomainError,
  type Id,
  type Result,
} from '@tamgiao/kernel';

export type DataExportId = Id<'DataExport'>;

/** Thời hạn tải file xuất dữ liệu kể từ khi sẵn sàng (BE-S7-06: "presigned link 24h"). */
export const DATA_EXPORT_TTL_HOURS = 24;

/** Trạng thái lưu: `PENDING` (worker đang dựng) → `READY`. `EXPIRED` là trạng thái suy ra (`READY` + quá hạn). */
export type DataExportStoredStatus = 'PENDING' | 'READY';
export type DataExportStatus = DataExportStoredStatus | 'EXPIRED';

export type DataExportDownloadError = DomainError<'DATA_EXPORT_NOT_READY' | 'DATA_EXPORT_EXPIRED'>;

export interface DataExportState {
  readonly id: DataExportId;
  readonly userId: string;
  readonly status: DataExportStoredStatus;
  readonly requestedAt: Date;
  readonly readyAt: Date | null;
  readonly expiresAt: Date | null;
  readonly version: number;
}

/**
 * Yêu cầu xuất dữ liệu cá nhân của chính chủ (quyền truy cập dữ liệu — NĐ 13/2023, BE-S7-06). Worker dựng file JSON
 * (nhận `DataExportRequested`) rồi `markReady`; file tải được trong `DATA_EXPORT_TTL_HOURS` giờ.
 */
export class DataExport extends AggregateRoot<DataExportId> {
  protected readonly aggregateType = 'DataExport';

  private constructor(private state: DataExportState) {
    super(state.id, state.version);
  }

  static request(userId: string, now: Date): DataExport {
    const exp = new DataExport({
      id: newId<'DataExport'>(),
      userId,
      status: 'PENDING',
      requestedAt: now,
      readyAt: null,
      expiresAt: null,
      version: 0,
    });
    exp.record('DataExportRequested', { exportId: exp.id, userId }, now);
    return exp;
  }

  static restore(state: DataExportState): DataExport {
    return new DataExport(state);
  }

  get userId(): string {
    return this.state.userId;
  }

  get status(): DataExportStoredStatus {
    return this.state.status;
  }

  /** Trạng thái nhìn từ thời điểm `now` (quá hạn tải → `EXPIRED`). */
  statusAt(now: Date): DataExportStatus {
    if (this.state.status === 'READY' && this.state.expiresAt !== null && now >= this.state.expiresAt) {
      return 'EXPIRED';
    }
    return this.state.status;
  }

  /** File đã dựng xong: tải được tới `now + DATA_EXPORT_TTL_HOURS`. Đã `READY` → `false` (consumer chạy lại no-op). */
  markReady(now: Date): boolean {
    if (this.state.status !== 'PENDING') return false;
    this.state = {
      ...this.state,
      status: 'READY',
      readyAt: now,
      expiresAt: addDuration(now, { hours: DATA_EXPORT_TTL_HOURS }),
    };
    return true;
  }

  /** Tải được khi đã `READY` và chưa quá hạn. */
  checkDownloadable(now: Date): Result<void, DataExportDownloadError> {
    const status = this.statusAt(now);
    if (status === 'PENDING') return fail('DATA_EXPORT_NOT_READY');
    if (status === 'EXPIRED') return fail('DATA_EXPORT_EXPIRED');
    return ok();
  }

  toState(): DataExportState {
    return { ...this.state, version: this.version };
  }
}
