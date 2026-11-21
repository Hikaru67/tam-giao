import { Entity, fail, ok, type DomainError, type Id, type Result } from '@tamgiao/kernel';

export type PartnerId = Id<'Partner'>;

/** Giới hạn dữ liệu quán (giữ khớp `@tamgiao/contracts` `partner-dto.ts`, có test). */
export const PARTNER_NAME_MAX_LENGTH = 120;
export const PARTNER_ADDRESS_MAX_LENGTH = 300;
export const PARTNER_TAG_MAX_LENGTH = 30;
export const PARTNER_TAGS_MAX = 10;

export type PartnerInvalid = DomainError<'PARTNER_INVALID'>;

export interface PartnerState {
  readonly id: PartnerId;
  readonly name: string;
  readonly address: string;
  /** URL https ảnh giới thiệu quán (công khai). */
  readonly photoUrl: string | null;
  readonly tags: readonly string[];
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PartnerPatch {
  readonly name?: string | undefined;
  readonly address?: string | undefined;
  readonly photoUrl?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly active?: boolean | undefined;
}

function text(field: string, value: string, max: number): Result<string, PartnerInvalid> {
  const v = value.trim();
  return v.length === 0 || v.length > max ? fail('PARTNER_INVALID', { field }) : ok(v);
}

/** Tag: bỏ khoảng trắng thừa, bỏ trùng (không phân biệt hoa thường), giữ thứ tự nhập. */
function normalizeTags(tags: readonly string[]): Result<readonly string[], PartnerInvalid> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (tag.length === 0 || tag.length > PARTNER_TAG_MAX_LENGTH)
      return fail('PARTNER_INVALID', { field: 'tags' });
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.length > PARTNER_TAGS_MAX ? fail('PARTNER_INVALID', { field: 'tags' }) : ok(out);
}

/**
 * Quán đối tác an toàn (BE-S4-06) — nơi người dùng hẹn gặp và đổi voucher. Quán không bị xoá, chỉ tắt `active`:
 * quán tắt không hiện cho người dùng, nhân viên quán không đăng nhập được và token đã cấp bị từ chối.
 */
export class Partner extends Entity<PartnerId> {
  private constructor(private state: PartnerState) {
    super(state.id);
  }

  static create(
    input: {
      readonly id: PartnerId;
      readonly name: string;
      readonly address: string;
      readonly photoUrl?: string | null;
      readonly tags?: readonly string[];
    },
    now: Date,
  ): Result<Partner, PartnerInvalid> {
    const name = text('name', input.name, PARTNER_NAME_MAX_LENGTH);
    if (name.isErr()) return fail(name.error.code, name.error.details);
    const address = text('address', input.address, PARTNER_ADDRESS_MAX_LENGTH);
    if (address.isErr()) return fail(address.error.code, address.error.details);
    const tags = normalizeTags(input.tags ?? []);
    if (tags.isErr()) return fail(tags.error.code, tags.error.details);
    return ok(
      new Partner({
        id: input.id,
        name: name.value,
        address: address.value,
        photoUrl: input.photoUrl ?? null,
        tags: tags.value,
        active: true,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  static restore(state: PartnerState): Partner {
    return new Partner({ ...state, tags: [...state.tags] });
  }

  get name(): string {
    return this.state.name;
  }

  get active(): boolean {
    return this.state.active;
  }

  /**
   * Cập nhật các trường có trong `patch` (mọi trường hợp lệ mới áp dụng). Trả danh sách trường thực sự thay đổi
   * (dùng cho audit); không đổi gì thì không chạm `updatedAt`.
   */
  update(patch: PartnerPatch, now: Date): Result<readonly (keyof PartnerPatch)[], PartnerInvalid> {
    const next: { -readonly [K in keyof PartnerState]: PartnerState[K] } = { ...this.state };
    if (patch.name !== undefined) {
      const v = text('name', patch.name, PARTNER_NAME_MAX_LENGTH);
      if (v.isErr()) return fail(v.error.code, v.error.details);
      next.name = v.value;
    }
    if (patch.address !== undefined) {
      const v = text('address', patch.address, PARTNER_ADDRESS_MAX_LENGTH);
      if (v.isErr()) return fail(v.error.code, v.error.details);
      next.address = v.value;
    }
    if (patch.tags !== undefined) {
      const v = normalizeTags(patch.tags);
      if (v.isErr()) return fail(v.error.code, v.error.details);
      next.tags = v.value;
    }
    if (patch.photoUrl !== undefined) next.photoUrl = patch.photoUrl;
    if (patch.active !== undefined) next.active = patch.active;

    const changed: (keyof PartnerPatch)[] = [];
    if (next.name !== this.state.name) changed.push('name');
    if (next.address !== this.state.address) changed.push('address');
    if (next.photoUrl !== this.state.photoUrl) changed.push('photoUrl');
    if (next.tags.join('\n') !== this.state.tags.join('\n')) changed.push('tags');
    if (next.active !== this.state.active) changed.push('active');
    if (changed.length > 0) this.state = { ...next, updatedAt: now };
    return ok(changed);
  }

  toState(): PartnerState {
    return { ...this.state, tags: [...this.state.tags] };
  }
}
