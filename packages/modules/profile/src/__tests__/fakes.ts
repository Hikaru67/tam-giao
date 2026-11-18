import {
  fail,
  ok,
  type Result,
  type Tx,
  type UnitOfWork,
  type UploadPurpose,
  type UploadRef,
  type UploadRegistry,
  type UploadVerifyError,
} from '@tamgiao/kernel';
import type {
  VerificationBadge,
  VerificationFacade,
  VerificationSummary,
} from '@tamgiao/module-verification/facade';
import type { ProfileRepository } from '../application/ports/profile-repository.js';
import { Profile, type ProfileState } from '../domain/profile.js';

export class InMemoryProfileRepository implements ProfileRepository {
  rows = new Map<string, ProfileState>();
  readonly events: unknown[] = [];

  async findById(_tx: Tx, userId: string): Promise<Profile | null> {
    const s = this.rows.get(userId);
    return s ? Profile.restore(s) : null;
  }
  findByIdForUpdate(tx: Tx, userId: string): Promise<Profile | null> {
    return this.findById(tx, userId);
  }
  async save(_tx: Tx, profile: Profile): Promise<void> {
    this.rows.set(profile.id, profile.toState());
    this.events.push(...profile.pullEvents());
  }
}

/** `FakeUnitOfWork` tối giản: `Err`/throw → khôi phục bảng hồ sơ. */
export class FakeUnitOfWork implements UnitOfWork {
  constructor(private readonly repo: InMemoryProfileRepository) {}
  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const rows = new Map(this.repo.rows);
    const events = this.repo.events.length;
    const rollback = () => {
      this.repo.rows = rows;
      this.repo.events.length = events;
    };
    try {
      const r = await work({} as Tx);
      if (r.isErr()) rollback();
      return r;
    } catch (e) {
      rollback();
      throw e;
    }
  }
}

/** Key `"<ownerId>:<key>"` đã được cấp; key khác → UPLOAD_NOT_OWNED. */
export class FakeUploadRegistry implements UploadRegistry {
  readonly owned = new Set<string>();
  readonly verified: string[] = [];
  grant(ownerId: string, key: string): void {
    this.owned.add(`${ownerId}:${key}`);
  }
  async verifyOwned(
    _tx: Tx,
    input: { ownerId: string; key: string; purposes: readonly UploadPurpose[] },
  ): Promise<Result<UploadRef, UploadVerifyError>> {
    this.verified.push(input.key);
    if (!this.owned.has(`${input.ownerId}:${input.key}`)) return fail('UPLOAD_NOT_OWNED');
    return ok({
      uploadId: input.key,
      ownerId: input.ownerId,
      key: input.key,
      bucket: 'publicProfile',
      purpose: 'profile_photo',
      contentType: 'image/jpeg',
      sizeBytes: 1,
    });
  }
}

/** Facade verification giả: trạng thái theo user, mặc định `NOT_SUBMITTED`. */
export class FakeVerificationFacade implements VerificationFacade {
  readonly summaries = new Map<string, VerificationSummary>();
  async getSummary(userId: string): Promise<VerificationSummary> {
    return this.summaries.get(userId) ?? { status: 'NOT_SUBMITTED', badges: [] };
  }
  async isVerified(userId: string): Promise<boolean> {
    return (await this.getSummary(userId)).status === 'APPROVED';
  }
  async getBadges(userId: string): Promise<readonly VerificationBadge[]> {
    return (await this.getSummary(userId)).badges;
  }
}
