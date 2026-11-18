import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { eq } from 'drizzle-orm';
import type { PreferencesRepository } from '../application/ports/preferences-repository.js';
import {
  CHILDREN_PLANS,
  type ChildrenPlan,
  CORE_TRAITS,
  type CoreTrait,
  DAILY_RHYTHMS,
  DRINKING_HABITS,
  FINANCIAL_INDEPENDENCE,
  type Lifestyle,
  Preferences,
  RELIGIONS,
  type Religion,
  SMOKING_HABITS,
  SPORTS_HABITS,
} from '../domain/preferences.js';
import { EDUCATION_LEVELS, type EducationLevel } from '../domain/profile.js';
import { preferences } from './schema.js';

export interface PreferencesDetails {
  readonly lifestyle: Lifestyle;
  readonly financialIndependence: (typeof FINANCIAL_INDEPENDENCE)[number];
  readonly coreTraits: readonly CoreTrait[];
}

const isChildrenPlan = (v: string): v is ChildrenPlan => (CHILDREN_PLANS as readonly string[]).includes(v);

const isReligion = (v: string): v is Religion => (RELIGIONS as readonly string[]).includes(v);

const isEducationLevelOrNull = (v: string | null): v is EducationLevel | null =>
  v === null || (EDUCATION_LEVELS as readonly string[]).includes(v);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSmokingHabit = (v: unknown): v is (typeof SMOKING_HABITS)[number] =>
  typeof v === 'string' && (SMOKING_HABITS as readonly string[]).includes(v);

const isDrinkingHabit = (v: unknown): v is (typeof DRINKING_HABITS)[number] =>
  typeof v === 'string' && (DRINKING_HABITS as readonly string[]).includes(v);

const isDailyRhythm = (v: unknown): v is (typeof DAILY_RHYTHMS)[number] =>
  typeof v === 'string' && (DAILY_RHYTHMS as readonly string[]).includes(v);

const isSportsHabit = (v: unknown): v is (typeof SPORTS_HABITS)[number] =>
  typeof v === 'string' && (SPORTS_HABITS as readonly string[]).includes(v);

const isFinancialIndependence = (v: unknown): v is (typeof FINANCIAL_INDEPENDENCE)[number] =>
  typeof v === 'string' && (FINANCIAL_INDEPENDENCE as readonly string[]).includes(v);

const isCoreTrait = (v: unknown): v is CoreTrait =>
  typeof v === 'string' && (CORE_TRAITS as readonly string[]).includes(v);

const isLifestyle = (v: unknown): v is Lifestyle => {
  if (!isRecord(v)) return false;
  return (
    isSmokingHabit(v['smoking']) &&
    isDrinkingHabit(v['drinking']) &&
    isDailyRhythm(v['dailyRhythm']) &&
    isSportsHabit(v['sports'])
  );
};

export function parseDetails(value: unknown, userId = 'unknown'): PreferencesDetails {
  if (!isRecord(value)) {
    throw new Error(`profile.preferences ${userId}: dữ liệu trong DB không hợp lệ`);
  }

  const lifestyle = value['lifestyle'];
  const financialIndependence = value['financialIndependence'];
  const coreTraits = value['coreTraits'];

  if (
    !isLifestyle(lifestyle) ||
    !isFinancialIndependence(financialIndependence) ||
    !Array.isArray(coreTraits) ||
    !coreTraits.every(isCoreTrait)
  ) {
    throw new Error(`profile.preferences ${userId}: dữ liệu trong DB không hợp lệ`);
  }

  return {
    lifestyle: {
      smoking: lifestyle.smoking,
      drinking: lifestyle.drinking,
      dailyRhythm: lifestyle.dailyRhythm,
      sports: lifestyle.sports,
    },
    financialIndependence,
    coreTraits: [...coreTraits],
  };
}

/** Hiện thực PreferencesRepository bằng Drizzle ORM và PostgreSQL. */
export class DrizzlePreferencesRepository implements PreferencesRepository {
  constructor(private readonly outbox: OutboxWriter) {}

  async findById(tx: Tx, userId: string): Promise<Preferences | null> {
    const [row] = await asDbTx(tx).select().from(preferences).where(eq(preferences.userId, userId));
    return row ? this.toDomain(row) : null;
  }

  async findByIdForUpdate(tx: Tx, userId: string): Promise<Preferences | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(preferences)
      .where(eq(preferences.userId, userId))
      .for('update');
    return row ? this.toDomain(row) : null;
  }

  async save(tx: Tx, p: Preferences): Promise<void> {
    const s = p.toState();
    const values = {
      userId: s.userId,
      ageMin: s.criteria.ageMin,
      ageMax: s.criteria.ageMax,
      areaCity: s.criteria.area.city,
      areaRadiusKm: s.criteria.area.radiusKm,
      childrenPlan: s.criteria.childrenPlan,
      religion: s.criteria.religion,
      minEducation: s.criteria.minEducation,
      details: {
        lifestyle: s.criteria.lifestyle,
        financialIndependence: s.criteria.financialIndependence,
        coreTraits: [...s.criteria.coreTraits],
      },
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      version: s.version,
    };

    await asDbTx(tx)
      .insert(preferences)
      .values(values)
      .onConflictDoUpdate({
        target: preferences.userId,
        set: {
          ageMin: values.ageMin,
          ageMax: values.ageMax,
          areaCity: values.areaCity,
          areaRadiusKm: values.areaRadiusKm,
          childrenPlan: values.childrenPlan,
          religion: values.religion,
          minEducation: values.minEducation,
          details: values.details,
          updatedAt: values.updatedAt,
          version: values.version,
        },
      });

    await this.outbox.append(tx, p.pullEvents());
  }

  private toDomain(row: typeof preferences.$inferSelect): Preferences {
    const details = parseDetails(row.details, row.userId);

    if (
      !isChildrenPlan(row.childrenPlan) ||
      !isReligion(row.religion) ||
      !isEducationLevelOrNull(row.minEducation)
    ) {
      throw new Error(`profile.preferences ${row.userId}: dữ liệu trong DB không hợp lệ`);
    }

    return Preferences.restore({
      userId: row.userId,
      criteria: {
        ageMin: row.ageMin,
        ageMax: row.ageMax,
        area: {
          city: row.areaCity,
          radiusKm: row.areaRadiusKm,
        },
        childrenPlan: row.childrenPlan,
        religion: row.religion,
        minEducation: row.minEducation,
        lifestyle: details.lifestyle,
        financialIndependence: details.financialIndependence,
        coreTraits: details.coreTraits,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
  }
}
