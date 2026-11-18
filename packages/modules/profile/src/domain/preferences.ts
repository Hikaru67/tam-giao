import { MIN_AGE } from '@tamgiao/contracts/constants';
import { AggregateRoot, fail, ok, type DomainError, type Result } from '@tamgiao/kernel';
import type { EducationLevel } from './profile.js';

// Danh mục giá trị — trùng với `@tamgiao/contracts` (domain không import Zod); `catalog.test.ts` giữ khớp.
export const NOT_IMPORTANT = 'not_important';
export const PREFERENCE_AGE_MAX = 80;
export const PREFERENCE_RADIUS_KM_MAX = 500;
export const CORE_TRAITS_COUNT = 3;

export const CHILDREN_PLANS = ['want_children', 'no_children', 'open', NOT_IMPORTANT] as const;
export const RELIGIONS = [
  'none',
  'buddhism',
  'catholicism',
  'protestantism',
  'caodaism',
  'hoa_hao',
  'other',
  NOT_IMPORTANT,
] as const;
export const SMOKING_HABITS = ['never', 'occasionally', 'regularly', NOT_IMPORTANT] as const;
export const DRINKING_HABITS = ['never', 'occasionally', 'regularly', NOT_IMPORTANT] as const;
export const DAILY_RHYTHMS = ['early_bird', 'night_owl', 'flexible', NOT_IMPORTANT] as const;
export const SPORTS_HABITS = ['regularly', 'sometimes', 'rarely', NOT_IMPORTANT] as const;
export const FINANCIAL_INDEPENDENCE = ['required', 'preferred', NOT_IMPORTANT] as const;
export const CORE_TRAITS = [
  'honest',
  'kind',
  'responsible',
  'ambitious',
  'family_oriented',
  'humorous',
  'patient',
  'independent',
  'loyal',
  'respectful',
  'generous',
  'optimistic',
] as const;

export type ChildrenPlan = (typeof CHILDREN_PLANS)[number];
export type Religion = (typeof RELIGIONS)[number];
export type CoreTrait = (typeof CORE_TRAITS)[number];

/** Lối sống — phần "mềm", lưu jsonb; mỗi mục có thể là "không quan trọng". */
export interface Lifestyle {
  readonly smoking: (typeof SMOKING_HABITS)[number];
  readonly drinking: (typeof DRINKING_HABITS)[number];
  readonly dailyRhythm: (typeof DAILY_RHYTHMS)[number];
  readonly sports: (typeof SPORTS_HABITS)[number];
}

/**
 * Tiêu chí bạn đời. Bộ lọc cứng (tuổi, khu vực, con cái, tôn giáo) lưu cột riêng để matching (BE-S5-03) lọc
 * bằng SQL; phần còn lại lưu jsonb.
 */
export interface PreferenceCriteria {
  readonly ageMin: number;
  readonly ageMax: number;
  readonly area: { readonly city: string | null; readonly radiusKm: number | null };
  readonly childrenPlan: ChildrenPlan;
  readonly religion: Religion;
  readonly lifestyle: Lifestyle;
  readonly minEducation: EducationLevel | null;
  readonly financialIndependence: (typeof FINANCIAL_INDEPENDENCE)[number];
  readonly coreTraits: readonly CoreTrait[];
}

export interface PreferencesState {
  readonly userId: string;
  readonly criteria: PreferenceCriteria;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export type PreferencesError = DomainError<'INVALID_CORE_TRAITS' | 'VALIDATION_FAILED'>;

function validate(c: PreferenceCriteria): Result<void, PreferencesError> {
  const ageOk = (a: number) => Number.isInteger(a) && a >= MIN_AGE && a <= PREFERENCE_AGE_MAX;
  if (!ageOk(c.ageMin) || !ageOk(c.ageMax)) {
    return fail('VALIDATION_FAILED', { field: 'age', min: MIN_AGE, max: PREFERENCE_AGE_MAX });
  }
  if (c.ageMin > c.ageMax) return fail('VALIDATION_FAILED', { field: 'age', reason: 'MIN_GREATER_THAN_MAX' });
  const r = c.area.radiusKm;
  if (r !== null && (!Number.isInteger(r) || r < 1 || r > PREFERENCE_RADIUS_KM_MAX)) {
    return fail('VALIDATION_FAILED', { field: 'area.radiusKm' });
  }
  if (c.coreTraits.length !== CORE_TRAITS_COUNT || new Set(c.coreTraits).size !== CORE_TRAITS_COUNT) {
    return fail('INVALID_CORE_TRAITS', { required: CORE_TRAITS_COUNT });
  }
  return ok();
}

export class Preferences extends AggregateRoot<string> {
  protected readonly aggregateType = 'Preferences';

  private constructor(
    private state: Omit<PreferencesState, 'version'>,
    version: number,
  ) {
    super(state.userId, version);
  }

  /** Lần đầu thiết lập tiêu chí. */
  static create(
    userId: string,
    criteria: PreferenceCriteria,
    now: Date,
  ): Result<Preferences, PreferencesError> {
    const valid = validate(criteria);
    if (valid.isErr()) return fail(valid.error.code, valid.error.details);
    const p = new Preferences({ userId, criteria, createdAt: now, updatedAt: now }, 0);
    p.record('PreferencesUpdated', { userId }, now);
    return ok(p);
  }

  static restore(state: PreferencesState): Preferences {
    const { version, ...rest } = state;
    return new Preferences(rest, version);
  }

  /** Ghi đè toàn bộ tiêu chí; mỗi lần lưu phát `PreferencesUpdated` để matching tính lại. */
  replace(criteria: PreferenceCriteria, now: Date): Result<void, PreferencesError> {
    const valid = validate(criteria);
    if (valid.isErr()) return valid;
    this.state = { ...this.state, criteria, updatedAt: now };
    this.record('PreferencesUpdated', { userId: this.id }, now);
    return ok();
  }

  toState(): PreferencesState {
    return { ...this.state, version: this.version };
  }
}
