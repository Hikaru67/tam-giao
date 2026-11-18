import { REFUND_SLA_HOURS } from '@tamgiao/contracts/constants';
import { addDuration, ok, type Clock, type UnitOfWork } from '@tamgiao/kernel';
import type { PendingRefund, RefundPaymentRepository } from '../ports/refund-repositories.js';

/** Số khoản tối đa mỗi lượt quét (lượt sau lấy tiếp — khoản đã hoàn rời khỏi tập `REFUND_PENDING`). */
export const REFUND_SCAN_LIMIT = 500;

interface RefundQueryDeps {
  readonly uow: UnitOfWork;
  readonly payments: RefundPaymentRepository;
}

/** Khoản `REFUND_PENDING` cần gọi cổng hoàn tiền (job điều phối đẩy mỗi khoản thành một job hoàn tiền). */
export class ListPendingRefunds {
  constructor(private readonly deps: RefundQueryDeps) {}

  async execute(limit = REFUND_SCAN_LIMIT): Promise<PendingRefund[]> {
    const r = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.payments.listRefundPending(tx, { limit })),
    );
    return r.unwrapOr([]);
  }
}

export interface OverdueRefund extends PendingRefund {
  /** Số giờ đã chờ kể từ khi yêu cầu hoàn (làm tròn xuống). */
  readonly hoursPending: number;
}

/**
 * Khoản `REFUND_PENDING` đã quá `REFUND_SLA_HOURS` kể từ `refundRequestedAt` (đúng mốc tính là quá hạn) — job cảnh báo
 * log mức error để gắn alert (AC3). Thời gian lấy từ `Clock` (A7).
 */
export class FindOverdueRefunds {
  constructor(private readonly deps: RefundQueryDeps & { readonly clock: Clock }) {}

  async execute(limit = REFUND_SCAN_LIMIT): Promise<OverdueRefund[]> {
    const now = this.deps.clock.now();
    const cutoff = addDuration(now, { hours: -REFUND_SLA_HOURS });
    const r = await this.deps.uow.run(async (tx) =>
      ok(await this.deps.payments.listRefundPending(tx, { limit, requestedAtOrBefore: cutoff })),
    );
    return r.unwrapOr([]).map((p) => ({
      ...p,
      hoursPending: Math.floor((now.getTime() - p.refundRequestedAt.getTime()) / 3_600_000),
    }));
  }
}
