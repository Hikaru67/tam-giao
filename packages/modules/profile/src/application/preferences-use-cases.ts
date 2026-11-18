import { err, fail, ok, type Clock, type DomainError, type Result, type UnitOfWork } from '@tamgiao/kernel';
import { Preferences, type PreferenceCriteria, type PreferencesState } from '../domain/preferences.js';
import type { PreferencesRepository } from './ports/preferences-repository.js';

export interface PreferencesDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly preferences: PreferencesRepository;
}

/** Tạo hoặc ghi đè tiêu chí bạn đời của chính người dùng (BE-S2-06). */
export class SavePreferences {
  constructor(private readonly deps: PreferencesDeps) {}

  async execute(cmd: {
    readonly userId: string;
    readonly criteria: PreferenceCriteria;
  }): Promise<Result<PreferencesState, DomainError>> {
    const { uow, clock, preferences } = this.deps;
    return uow.run(async (tx) => {
      const now = clock.now();
      const existing = await preferences.findByIdForUpdate(tx, cmd.userId);
      let aggregate: Preferences;
      if (existing) {
        const replaced = existing.replace(cmd.criteria, now);
        if (replaced.isErr()) return err(replaced.error);
        aggregate = existing;
      } else {
        const created = Preferences.create(cmd.userId, cmd.criteria, now);
        if (created.isErr()) return err(created.error);
        aggregate = created.value;
      }
      await preferences.save(tx, aggregate);
      return ok(aggregate.toState());
    });
  }
}

export class GetPreferences {
  constructor(private readonly deps: Pick<PreferencesDeps, 'uow' | 'preferences'>) {}

  async execute(userId: string): Promise<Result<PreferencesState, DomainError<'NOT_FOUND'>>> {
    const found = await this.deps.uow.run(async (tx) => ok(await this.deps.preferences.findById(tx, userId)));
    const p = found.unwrapOr(null);
    return p === null ? fail('NOT_FOUND') : ok(p.toState());
  }
}

export type { PreferencesState } from '../domain/preferences.js';
