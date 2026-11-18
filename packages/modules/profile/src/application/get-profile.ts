import {
  fail,
  ok,
  type DomainError,
  type ObjectStorage,
  type Result,
  type UnitOfWork,
} from '@tamgiao/kernel';
import type { ProfileState } from '../domain/profile.js';
import type { ProfileRepository } from './ports/profile-repository.js';

export interface ProfileView {
  readonly profile: ProfileState;
  /** Cùng thứ tự `profile.data.photos`; URL GET ngắn hạn (bucket ảnh hồ sơ vẫn cần đăng nhập mới lấy được URL). */
  readonly photos: readonly { readonly key: string; readonly url: string }[];
}

export interface GetProfileDeps {
  readonly uow: UnitOfWork;
  readonly profiles: ProfileRepository;
  readonly storage: ObjectStorage;
}

/** Hồ sơ của chính chủ, kèm trường riêng tư đã giải mã. */
export class GetProfile {
  constructor(private readonly deps: GetProfileDeps) {}

  async execute(userId: string): Promise<Result<ProfileView, DomainError<'NOT_FOUND'>>> {
    const found = await this.deps.uow.run(async (tx) => ok(await this.deps.profiles.findById(tx, userId)));
    const profile = found.unwrapOr(null);
    if (profile === null) return fail('NOT_FOUND');

    const state = profile.toState();
    const photos = await Promise.all(
      state.data.photos.map(async (key) => ({
        key,
        url: (await this.deps.storage.presignGet({ bucket: 'publicProfile', key })).url,
      })),
    );
    return ok({ profile: state, photos });
  }
}
