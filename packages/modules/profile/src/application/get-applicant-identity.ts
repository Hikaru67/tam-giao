import { ok, type UnitOfWork } from '@tamgiao/kernel';
import type { ApplicantIdentity } from './facade.js';
import type { ProfileRepository } from './ports/profile-repository.js';

/** Hiện thực `ProfileFacade.getApplicantIdentity`. */
export class GetApplicantIdentity {
  constructor(private readonly deps: { readonly uow: UnitOfWork; readonly profiles: ProfileRepository }) {}

  async execute(userId: string): Promise<ApplicantIdentity | null> {
    const found = await this.deps.uow.run(async (tx) => ok(await this.deps.profiles.findById(tx, userId)));
    const data = found.unwrapOr(null)?.toState().data;
    if (!data?.fullName || !data.birthDate) return null;
    return { fullName: data.fullName, birthDate: data.birthDate };
  }
}
