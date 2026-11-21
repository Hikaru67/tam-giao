import { asDbTx } from '@tamgiao/db';
import { ok, type UnitOfWork } from '@tamgiao/kernel';
import { and, eq } from 'drizzle-orm';
import type { MatchingProfile } from '../application/facade.js';
import { CHILDREN_PLANS, RELIGIONS, type ChildrenPlan, type Religion } from '../domain/preferences.js';
import {
  EDUCATION_LEVELS,
  GENDERS,
  PROFILE_CHILDREN_PLANS,
  PROFILE_RELIGIONS,
  type EducationLevel,
  type Gender,
  type ProfileChildrenPlan,
  type ProfileReligion,
} from '../domain/profile.js';
import { parseDetails } from './drizzle-preferences-repository.js';
import { preferences, profiles } from './schema.js';

const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (v: string | null): v is T =>
    v !== null && (values as readonly string[]).includes(v);

const isGender = isOneOf<Gender>(GENDERS);
const isEducation = isOneOf<EducationLevel>(EDUCATION_LEVELS);
const isChildrenPlan = isOneOf<ChildrenPlan>(CHILDREN_PLANS);
const isReligion = isOneOf<Religion>(RELIGIONS);
const isOwnReligion = isOneOf<ProfileReligion>(PROFILE_RELIGIONS);
const isOwnChildrenPlan = isOneOf<ProfileChildrenPlan>(PROFILE_CHILDREN_PLANS);

/**
 * Hiện thực `ProfileFacade.getMatchingProfile` (BE-S5-03). Module "mỏng" (A11): đọc thẳng `profile.profiles` +
 * `profile.preferences`, chỉ các cột không mã hoá — không cần `Encryptor`, worker dựng được mà không nối cả module.
 */
export class DrizzleMatchingProfileReader {
  constructor(private readonly uow: UnitOfWork) {}

  async getMatchingProfile(userId: string): Promise<MatchingProfile | null> {
    const found = await this.uow.run(async (tx) => {
      const [row] = await asDbTx(tx)
        .select({
          userId: profiles.userId,
          gender: profiles.gender,
          birthDate: profiles.birthDate,
          currentCity: profiles.currentCity,
          education: profiles.education,
          ownReligion: profiles.religion,
          ownChildrenPlan: profiles.childrenPlan,
          profileVersion: profiles.version,
          ageMin: preferences.ageMin,
          ageMax: preferences.ageMax,
          areaCity: preferences.areaCity,
          areaRadiusKm: preferences.areaRadiusKm,
          childrenPlan: preferences.childrenPlan,
          religion: preferences.religion,
          minEducation: preferences.minEducation,
          details: preferences.details,
          preferencesVersion: preferences.version,
        })
        .from(profiles)
        .innerJoin(preferences, eq(preferences.userId, profiles.userId))
        .where(and(eq(profiles.userId, userId), eq(profiles.status, 'COMPLETED')));
      return ok(row ?? null);
    });
    const row = found.unwrapOr(null);
    if (row === null) return null;

    const { gender, birthDate, currentCity, education, childrenPlan, religion, minEducation } = row;
    const { ownReligion, ownChildrenPlan } = row;
    if (
      !isGender(gender) ||
      birthDate === null ||
      currentCity === null ||
      !isEducation(education) ||
      !isChildrenPlan(childrenPlan) ||
      !isReligion(religion) ||
      (minEducation !== null && !isEducation(minEducation)) ||
      (ownReligion !== null && !isOwnReligion(ownReligion)) ||
      (ownChildrenPlan !== null && !isOwnChildrenPlan(ownChildrenPlan))
    ) {
      throw new Error(`profile ${row.userId}: dữ liệu hồ sơ/tiêu chí trong DB không hợp lệ`);
    }
    const details = parseDetails(row.details, row.userId);
    return {
      userId: row.userId,
      gender,
      birthDate,
      currentCity,
      education,
      religion: ownReligion,
      childrenPlan: ownChildrenPlan,
      criteria: {
        ageMin: row.ageMin,
        ageMax: row.ageMax,
        areaCity: row.areaCity,
        areaRadiusKm: row.areaRadiusKm,
        childrenPlan,
        religion,
        minEducation,
        lifestyle: details.lifestyle,
        financialIndependence: details.financialIndependence,
        coreTraits: details.coreTraits,
      },
      profileVersion: row.profileVersion,
      preferencesVersion: row.preferencesVersion,
    };
  }
}
