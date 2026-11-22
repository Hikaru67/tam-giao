import { fail, ok, parseId, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { AccountDeletionId } from '../../domain/account-deletion.js';
import type {
  AccountDeletionRepository,
  AccountDeletionStep,
  ConsumerProgressReader,
} from '../ports/data-rights.js';

export interface AccountDeletionView {
  readonly requestId: string;
  /** `COMPLETED` khi mọi module đã xử lý xong `AccountDeletionRequested`. */
  readonly status: 'PROCESSING' | 'COMPLETED';
  readonly requestedAt: Date;
  readonly steps: readonly { readonly module: string; readonly done: boolean }[];
}

export interface GetAccountDeletionStatusDeps {
  readonly uow: UnitOfWork;
  readonly deletions: AccountDeletionRepository;
  readonly progress: ConsumerProgressReader;
  readonly steps: readonly AccountDeletionStep[];
}

/**
 * Tiến độ xoá tài khoản (BE-S7-06) theo id yêu cầu — không cần đăng nhập (phiên đã bị thu hồi), id là UUID ngẫu nhiên
 * và kết quả không chứa PII. Bước `done` = consumer của module đã ghi `processed_events` cho event của yêu cầu.
 */
export class GetAccountDeletionStatus {
  constructor(private readonly deps: GetAccountDeletionStatusDeps) {}

  async execute(
    requestId: string,
  ): Promise<Result<AccountDeletionView, DomainError<'INVALID_ID' | 'NOT_FOUND'>>> {
    const id = parseId<'AccountDeletion'>(requestId);
    if (id.isErr()) return fail('INVALID_ID');
    const { deletions, progress, steps } = this.deps;

    return this.deps.uow.run(async (tx) => {
      const deletion = await deletions.findById(tx, id.value as AccountDeletionId);
      if (!deletion) return fail('NOT_FOUND');
      const done = await progress.processedConsumers(
        tx,
        deletion.eventId,
        steps.map((s) => s.consumer),
      );
      const items = steps.map((s) => ({ module: s.module, done: done.has(s.consumer) }));
      return ok({
        requestId: deletion.id,
        status: items.every((s) => s.done) ? ('COMPLETED' as const) : ('PROCESSING' as const),
        requestedAt: deletion.requestedAt,
        steps: items,
      });
    });
  }
}
