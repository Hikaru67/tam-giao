import type { DomainEvent, Result, Tx, UnitOfWork } from '@tamgiao/kernel';
import type { LedgerRepository } from '../application/ports/payment-repositories.js';
import type { VoucherLifecycleRepository } from '../application/ports/voucher-lifecycle-repository.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import { Voucher, type VoucherState } from '../domain/voucher.js';

/**
 * Kho in-memory cho voucher (BE-S4-05) + ledger + outbox. Mô phỏng unique ledger `(voucher_id, type)` và
 * `FOR UPDATE SKIP LOCKED` (`locked`: id dòng đang bị transaction khác giữ).
 */
export class InMemoryVoucherStore {
  vouchers = new Map<string, VoucherState>();
  ledger: LedgerEntry[] = [];
  events: DomainEvent[] = [];
  locked = new Set<string>();
  saves = 0;

  /** Thêm thẳng voucher (seed test) — bỏ event đã ghi khi dựng. */
  seed(voucher: Voucher): Voucher {
    voucher.pullEvents();
    this.vouchers.set(voucher.id, voucher.toState());
    return voucher;
  }

  get(id: string): VoucherState {
    const s = this.vouchers.get(id);
    if (!s) throw new Error(`voucher ${id} not found`);
    return s;
  }

  snapshot() {
    return { vouchers: new Map(this.vouchers), ledger: [...this.ledger], events: [...this.events] };
  }

  restore(s: ReturnType<InMemoryVoucherStore['snapshot']>): void {
    this.vouchers = s.vouchers;
    this.ledger = s.ledger;
    this.events = s.events;
  }

  private load = (id: string): Voucher | null => {
    const s = this.vouchers.get(id);
    return s ? Voucher.restore(s) : null;
  };

  readonly voucherRepo: VoucherLifecycleRepository = {
    findById: async (_tx, id) => this.load(id),
    findByIdForUpdate: async (_tx, id) => this.load(id),
    listByUser: async (_tx, userId) =>
      [...this.vouchers.values()]
        .filter((v) => v.userId === userId)
        .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
        .map((s) => Voucher.restore(s)),
    lockDueForExpiry: async (_tx, now, limit) =>
      [...this.vouchers.values()]
        .filter(
          (v) =>
            (v.status === 'RESERVED' || v.status === 'ACTIVE') &&
            v.expiresAt !== null &&
            v.expiresAt.getTime() <= now.getTime() &&
            !this.locked.has(v.id),
        )
        .sort((a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0))
        .slice(0, limit)
        .map((s) => Voucher.restore(s)),
    save: async (_tx, voucher) => {
      if (!this.vouchers.has(voucher.id)) throw new Error('voucher not found');
      this.saves++;
      this.vouchers.set(voucher.id, voucher.toState());
      this.events.push(...voucher.pullEvents());
    },
  };

  readonly ledgerRepo: LedgerRepository = {
    append: async (_tx, entries) => {
      for (const e of entries) {
        if (
          e.voucherId !== null &&
          this.ledger.some((l) => l.voucherId === e.voucherId && l.type === e.type)
        ) {
          throw new Error('unique violation: ledger_entries_voucher_type_uq');
        }
      }
      this.ledger.push(...entries);
    },
  };
}

/** `Err`/throw → khôi phục kho (mô phỏng rollback). */
export class FakeVoucherUnitOfWork implements UnitOfWork {
  runs = 0;
  constructor(private readonly store: InMemoryVoucherStore) {}
  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    this.runs++;
    const snapshot = this.store.snapshot();
    try {
      const r = await work({} as Tx);
      if (r.isErr()) this.store.restore(snapshot);
      return r;
    } catch (e) {
      this.store.restore(snapshot);
      throw e;
    }
  }
}
