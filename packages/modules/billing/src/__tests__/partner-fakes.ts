import { fail, ok, type DomainError, type Result, type Tx, type UnitOfWork } from '@tamgiao/kernel';
import type { AuditLogger, AuditLogInput } from '@tamgiao/module-identity/facade';
import type { PartnerPinHasher } from '../application/ports/partner-pin-hasher.js';
import type {
  PartnerListFilter,
  PartnerRepository,
  PartnerStaffRepository,
} from '../application/ports/partner-repositories.js';
import type {
  IssuedPartnerToken,
  PartnerTokenClaims,
  PartnerTokenService,
} from '../application/ports/partner-token-service.js';
import { Partner, type PartnerId, type PartnerState } from '../domain/partner.js';
import { PartnerStaff, type PartnerStaffId, type PartnerStaffState } from '../domain/partner-staff.js';

/** Kho in-memory cho quán + nhân viên (lưu state, không lưu tham chiếu entity → giống DB). */
export class InMemoryPartnerStore implements PartnerRepository {
  partners = new Map<string, PartnerState>();
  staffRows = new Map<string, PartnerStaffState>();

  async findById(_tx: Tx, id: PartnerId): Promise<Partner | null> {
    const s = this.partners.get(id);
    return s ? Partner.restore(s) : null;
  }
  findByIdForUpdate(tx: Tx, id: PartnerId): Promise<Partner | null> {
    return this.findById(tx, id);
  }
  async save(_tx: Tx, partner: Partner): Promise<void> {
    this.partners.set(partner.id, partner.toState());
  }
  async list(_tx: Tx, filter: PartnerListFilter): Promise<Partner[]> {
    return [...this.partners.values()]
      .filter((p) => filter.active === undefined || p.active === filter.active)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => Partner.restore(s));
  }

  readonly staff: PartnerStaffRepository = {
    findById: async (_tx, id: PartnerStaffId) => {
      const s = this.staffRows.get(id);
      return s ? PartnerStaff.restore(s) : null;
    },
    findByIdForUpdate: (tx, id) => this.staff.findById(tx, id),
    save: async (_tx, staff) => {
      this.staffRows.set(staff.id, staff.toState());
    },
    listByPartner: async (_tx, partnerId) =>
      [...this.staffRows.values()]
        .filter((s) => s.partnerId === partnerId)
        .map((s) => PartnerStaff.restore(s)),
  };
}

/** UoW giả: `Err`/throw → khôi phục snapshot của kho (mô phỏng rollback). */
export class FakePartnerUnitOfWork implements UnitOfWork {
  constructor(private readonly store: InMemoryPartnerStore) {}

  async run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const partners = new Map(this.store.partners);
    const staff = new Map(this.store.staffRows);
    const rollback = () => {
      this.store.partners = partners;
      this.store.staffRows = staff;
    };
    try {
      const result = await work({} as Tx);
      if (result.isErr()) rollback();
      return result;
    } catch (error) {
      rollback();
      throw error;
    }
  }
}

/** Hash giả có thể đọc được: `hashed:<pin>` (chỉ dùng trong unit test). */
export class FakePartnerPinHasher implements PartnerPinHasher {
  verifiedWithNull = 0;
  async hash(pin: string): Promise<string> {
    return `hashed:${pin}`;
  }
  async verify(hash: string | null, pin: string): Promise<boolean> {
    if (hash === null) {
      this.verifiedWithNull++;
      return false;
    }
    return hash === `hashed:${pin}`;
  }
}

/** Token giả `JSON` không ký — đủ để test luồng application (chữ ký test riêng ở `partner-crypto.test.ts`). */
export class FakePartnerTokenService implements PartnerTokenService {
  issue(claims: PartnerTokenClaims, now: Date, ttlSeconds: number): IssuedPartnerToken {
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);
    return { token: JSON.stringify({ ...claims, exp: expiresAt.getTime() }), expiresAt };
  }
  verify(token: string, now: Date): Result<PartnerTokenClaims, DomainError<'PARTNER_TOKEN_INVALID'>> {
    try {
      const v = JSON.parse(token) as PartnerTokenClaims & { exp: number };
      if (now.getTime() >= v.exp) return fail('PARTNER_TOKEN_INVALID');
      return ok({ staffId: v.staffId, partnerId: v.partnerId, tokenVersion: v.tokenVersion });
    } catch {
      return fail('PARTNER_TOKEN_INVALID');
    }
  }
}

/** Ghi lại mọi bản ghi audit; `failWith` → trả `Err` (mô phỏng meta bị từ chối). */
export class RecordingPartnerAuditLogger implements AuditLogger {
  entries: AuditLogInput[] = [];
  failWith: string | null = null;
  log(entry: AuditLogInput): Promise<Result<void, DomainError>>;
  log(tx: Tx, entry: AuditLogInput): Promise<Result<void, DomainError>>;
  async log(a: Tx | AuditLogInput, b?: AuditLogInput): Promise<Result<void, DomainError>> {
    if (this.failWith !== null) return fail(this.failWith);
    this.entries.push(b ?? (a as AuditLogInput));
    return ok();
  }
}
