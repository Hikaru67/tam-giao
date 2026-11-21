import { ok, type Clock, type UnitOfWork } from '@tamgiao/kernel';
import type { VoucherLifecycleRepository } from '../ports/voucher-lifecycle-repository.js';

const DEFAULT_BATCH_SIZE = 100;

export interface ExpireDueVouchersDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly vouchers: VoucherLifecycleRepository;
}

export interface ExpireDueVouchersCommand {
  /** Số voucher xử lý mỗi lô / transaction (mặc định 100). */
  readonly batchSize?: number;
}

/** Kết quả một lượt chạy — chỉ số đếm (không PII). */
export interface VoucherExpirySummary {
  /** Voucher đã chuyển `EXPIRED` trong lượt này. */
  readonly expired: number;
  /** Số lô (transaction) đã chạy. */
  readonly batches: number;
}

/**
 * Job hết hạn voucher (BE-S4-05): voucher `RESERVED | ACTIVE` có `expires_at <= now` → `expire(now)`, event
 * `VoucherExpired` qua outbox. **Không** ghi ledger (không có loại bút toán hết hạn — đối soát BE-S4-07 đếm theo bảng
 * `vouchers`). Mỗi lô một transaction: khoá `FOR UPDATE SKIP LOCKED` (dòng đang bị đổi/khoá ở transaction khác được
 * bỏ qua, lượt sau xử lý) → kiểm tra lại luật domain → lưu.
 * Idempotent (A9): voucher đã `EXPIRED` không còn khớp điều kiện chọn → chạy lại không đổi gì, không event trùng.
 */
export class ExpireDueVouchers {
  constructor(private readonly deps: ExpireDueVouchersDeps) {}

  async execute(cmd: ExpireDueVouchersCommand = {}): Promise<VoucherExpirySummary> {
    const limit = cmd.batchSize ?? DEFAULT_BATCH_SIZE;
    const now = this.deps.clock.now();
    let expired = 0;
    let batches = 0;
    for (;;) {
      const result = await this.deps.uow.run(async (tx) => {
        const due = await this.deps.vouchers.lockDueForExpiry(tx, now, limit);
        let changed = 0;
        for (const voucher of due) {
          // Đã khoá + lọc theo hạn ở DB; kiểm tra lại bằng luật domain, không khớp thì bỏ qua.
          if (voucher.expire(now).isErr()) continue;
          await this.deps.vouchers.save(tx, voucher);
          changed++;
        }
        return ok({ found: due.length, changed });
      });
      batches++;
      const { found, changed } = result.unwrapOr({ found: 0, changed: 0 });
      expired += changed;
      // Lô chưa đầy = hết việc; lô không đổi được gì = tránh lặp vô hạn trên cùng các dòng.
      if (found < limit || changed === 0) break;
    }
    return { expired, batches };
  }
}
