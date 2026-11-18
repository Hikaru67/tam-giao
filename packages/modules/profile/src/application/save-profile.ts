import {
  err,
  ok,
  type Clock,
  type DomainError,
  type Result,
  type UnitOfWork,
  type UploadRegistry,
} from '@tamgiao/kernel';
import { Profile, type ProfileData, type ProfileStatus } from '../domain/profile.js';
import type { ProfileRepository } from './ports/profile-repository.js';

export interface SaveProfileCommand {
  readonly userId: string;
  readonly data: ProfileData;
  /** `false` = "Lưu tạm", `true` = "Tiếp tục". */
  readonly submit: boolean;
}

export interface SaveProfileDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly profiles: ProfileRepository;
  readonly uploads: UploadRegistry;
}

/** Tạo/cập nhật hồ sơ cơ bản của chính người dùng (BE-S2-05). */
export class SaveProfile {
  constructor(private readonly deps: SaveProfileDeps) {}

  async execute(cmd: SaveProfileCommand): Promise<Result<{ status: ProfileStatus }, DomainError>> {
    const { uow, clock, profiles, uploads } = this.deps;
    return uow.run(async (tx) => {
      const now = clock.now();
      const profile = (await profiles.findByIdForUpdate(tx, cmd.userId)) ?? Profile.start(cmd.userId, now);

      // Kiểm tra luật của form trước (rẻ, không I/O), rồi mới xác nhận từng key ảnh.
      const updated = profile.update(cmd.data, { submit: cmd.submit }, now);
      if (updated.isErr()) return err(updated.error);

      for (const key of cmd.data.photos) {
        const owned = await uploads.verifyOwned(tx, {
          ownerId: cmd.userId,
          key,
          purposes: ['profile_photo'],
        });
        if (owned.isErr()) return err(owned.error);
      }

      await profiles.save(tx, profile);
      return ok({ status: profile.status });
    });
  }
}
