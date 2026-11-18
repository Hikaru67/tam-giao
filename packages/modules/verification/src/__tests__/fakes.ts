import {
  fail,
  ok,
  type DomainEvent,
  type Result,
  type Tx,
  type UnitOfWork,
  type UploadPurpose,
  type UploadRef,
  type UploadRegistry,
  type UploadVerifyError,
} from '@tamgiao/kernel';
import type { ApplicantProfileReader } from '../application/ports/applicant-profile-reader.js';
import type {
  KycSaveError,
  KycSubmissionRepository,
} from '../application/ports/kyc-submission-repository.js';
import { KycSubmission, type KycSubmissionState } from '../domain/kyc-submission.js';

/** Repository in-memory mô phỏng 2 ràng buộc unique của DB (`user_id`, số CCCD). */
export class InMemoryKycSubmissionRepository implements KycSubmissionRepository {
  rows = new Map<string, KycSubmissionState>();
  events: DomainEvent[] = [];

  async findByUserId(_tx: Tx, userId: string): Promise<KycSubmission | null> {
    const s = [...this.rows.values()].find((r) => r.userId === userId);
    return s ? KycSubmission.restore(s) : null;
  }
  findByUserIdForUpdate(tx: Tx, userId: string): Promise<KycSubmission | null> {
    return this.findByUserId(tx, userId);
  }
  async save(_tx: Tx, submission: KycSubmission): Promise<Result<void, KycSaveError>> {
    const s = submission.toState();
    for (const other of this.rows.values()) {
      if (other.id === s.id) continue;
      if (other.userId === s.userId) return fail('KYC_ALREADY_SUBMITTED');
      if (s.cccdNumber !== null && other.cccdNumber?.equals(s.cccdNumber))
        return fail('CCCD_ALREADY_REGISTERED');
    }
    this.rows.set(s.id, s);
    this.events.push(...submission.pullEvents());
    return ok();
  }
}

/** `Err`/throw → khôi phục repository (mô phỏng rollback). */
export class FakeUnitOfWork implements UnitOfWork {
  runs = 0;
  constructor(private readonly repo: InMemoryKycSubmissionRepository) {}
  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    this.runs++;
    const rows = new Map(this.repo.rows);
    const events = [...this.repo.events];
    const rollback = () => {
      this.repo.rows = rows;
      this.repo.events = events;
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

/** Key `"<ownerId>:<key>"` đã được cấp kèm mục đích; key khác → `UPLOAD_NOT_OWNED`. */
export class FakeUploadRegistry implements UploadRegistry {
  private readonly owned = new Map<string, UploadPurpose>();
  grant(ownerId: string, key: string, purpose: UploadPurpose): void {
    this.owned.set(`${ownerId}:${key}`, purpose);
  }
  async verifyOwned(
    _tx: Tx,
    input: { ownerId: string; key: string; purposes: readonly UploadPurpose[] },
  ): Promise<Result<UploadRef, UploadVerifyError>> {
    const purpose = this.owned.get(`${input.ownerId}:${input.key}`);
    if (purpose === undefined) return fail('UPLOAD_NOT_OWNED');
    if (!input.purposes.includes(purpose)) return fail('UPLOAD_INVALID', { reason: 'WRONG_PURPOSE' });
    return ok({
      uploadId: input.key,
      ownerId: input.ownerId,
      key: input.key,
      bucket: 'privateKyc',
      purpose,
      contentType: 'image/jpeg',
      sizeBytes: 1,
    });
  }
}

export class FakeApplicantProfileReader implements ApplicantProfileReader {
  readonly identities = new Map<string, { fullName: string; birthDate: string }>();
  async getApplicantIdentity(userId: string) {
    return this.identities.get(userId) ?? null;
  }
}
