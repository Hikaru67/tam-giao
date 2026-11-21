import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import type { Encryptor, Tx } from '@tamgiao/kernel';
import { eq } from 'drizzle-orm';
import type { ProfileRepository } from '../application/ports/profile-repository.js';
import {
  EDUCATION_LEVELS,
  type EducationLevel,
  GENDERS,
  type Gender,
  HOUSING_TYPES,
  type HousingType,
  INCOME_RANGES,
  type IncomeRange,
  PROFILE_CHILDREN_PLANS,
  PROFILE_RELIGIONS,
  PROFILE_STATUSES,
  type ProfileChildrenPlan,
  type ProfileReligion,
  type ProfileStatus,
  Profile,
  type ProfileId,
} from '../domain/profile.js';
import { profiles } from './schema.js';

const incomeRangeContext = (userId: string) => `profile.profiles.income_range:${userId}`;
const housingContext = (userId: string) => `profile.profiles.housing:${userId}`;
const assetsContext = (userId: string) => `profile.profiles.assets:${userId}`;

const isGenderOrNull = (v: string | null): v is Gender | null =>
  v === null || (GENDERS as readonly string[]).includes(v);

const isEducationLevelOrNull = (v: string | null): v is EducationLevel | null =>
  v === null || (EDUCATION_LEVELS as readonly string[]).includes(v);

const isIncomeRangeOrNull = (v: string | null): v is IncomeRange | null =>
  v === null || (INCOME_RANGES as readonly string[]).includes(v);

const isHousingTypeOrNull = (v: string | null): v is HousingType | null =>
  v === null || (HOUSING_TYPES as readonly string[]).includes(v);

const isReligionOrNull = (v: string | null): v is ProfileReligion | null =>
  v === null || (PROFILE_RELIGIONS as readonly string[]).includes(v);

const isChildrenPlanOrNull = (v: string | null): v is ProfileChildrenPlan | null =>
  v === null || (PROFILE_CHILDREN_PLANS as readonly string[]).includes(v);

const isProfileStatus = (v: string): v is ProfileStatus =>
  (PROFILE_STATUSES as readonly string[]).includes(v);

/** Hiện thực ProfileRepository bằng Drizzle ORM và PostgreSQL. */
export class DrizzleProfileRepository implements ProfileRepository {
  constructor(
    private readonly encryptor: Encryptor,
    private readonly outbox: OutboxWriter,
  ) {}

  async findById(tx: Tx, userId: ProfileId): Promise<Profile | null> {
    const [row] = await asDbTx(tx).select().from(profiles).where(eq(profiles.userId, userId));
    return row ? this.toDomain(row) : null;
  }

  async findByIdForUpdate(tx: Tx, userId: ProfileId): Promise<Profile | null> {
    const [row] = await asDbTx(tx).select().from(profiles).where(eq(profiles.userId, userId)).for('update');
    return row ? this.toDomain(row) : null;
  }

  async save(tx: Tx, profile: Profile): Promise<void> {
    const s = profile.toState();
    const incomeRangeEnc =
      s.data.incomeRange !== null
        ? await this.encryptor.encrypt(s.data.incomeRange, incomeRangeContext(s.userId))
        : null;
    const housingEnc =
      s.data.housing !== null ? await this.encryptor.encrypt(s.data.housing, housingContext(s.userId)) : null;
    const assetsEnc =
      s.data.assets !== null ? await this.encryptor.encrypt(s.data.assets, assetsContext(s.userId)) : null;

    const values = {
      userId: s.userId,
      fullName: s.data.fullName,
      birthDate: s.data.birthDate,
      gender: s.data.gender,
      hometown: s.data.hometown,
      currentCity: s.data.currentCity,
      education: s.data.education,
      occupation: s.data.occupation,
      religion: s.data.religion,
      childrenPlan: s.data.childrenPlan,
      bio: s.data.bio,
      interests: [...s.data.interests],
      incomeRangeEnc,
      housingEnc,
      assetsEnc,
      photoKeys: [...s.data.photos],
      status: s.status,
      completedAt: s.completedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      version: s.version,
    };

    await asDbTx(tx)
      .insert(profiles)
      .values(values)
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          fullName: values.fullName,
          birthDate: values.birthDate,
          gender: values.gender,
          hometown: values.hometown,
          currentCity: values.currentCity,
          education: values.education,
          occupation: values.occupation,
          religion: values.religion,
          childrenPlan: values.childrenPlan,
          bio: values.bio,
          interests: values.interests,
          incomeRangeEnc: values.incomeRangeEnc,
          housingEnc: values.housingEnc,
          assetsEnc: values.assetsEnc,
          photoKeys: values.photoKeys,
          status: values.status,
          completedAt: values.completedAt,
          updatedAt: values.updatedAt,
          version: values.version,
        },
      });

    await this.outbox.append(tx, profile.pullEvents());
  }

  private async toDomain(row: typeof profiles.$inferSelect): Promise<Profile> {
    const incomeRange =
      row.incomeRangeEnc !== null
        ? await this.encryptor.decrypt(row.incomeRangeEnc, incomeRangeContext(row.userId))
        : null;
    const housing =
      row.housingEnc !== null
        ? await this.encryptor.decrypt(row.housingEnc, housingContext(row.userId))
        : null;
    const assets =
      row.assetsEnc !== null ? await this.encryptor.decrypt(row.assetsEnc, assetsContext(row.userId)) : null;

    if (
      !isGenderOrNull(row.gender) ||
      !isEducationLevelOrNull(row.education) ||
      !isReligionOrNull(row.religion) ||
      !isChildrenPlanOrNull(row.childrenPlan) ||
      !isIncomeRangeOrNull(incomeRange) ||
      !isHousingTypeOrNull(housing) ||
      !isProfileStatus(row.status)
    ) {
      throw new Error(`profile.profiles ${row.userId}: dữ liệu trong DB không hợp lệ`);
    }

    return Profile.restore({
      userId: row.userId,
      data: {
        fullName: row.fullName,
        birthDate: row.birthDate,
        gender: row.gender,
        hometown: row.hometown,
        currentCity: row.currentCity,
        education: row.education,
        occupation: row.occupation,
        religion: row.religion,
        childrenPlan: row.childrenPlan,
        bio: row.bio,
        interests: row.interests,
        incomeRange,
        housing,
        assets,
        photos: row.photoKeys,
      },
      status: row.status,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
  }
}
