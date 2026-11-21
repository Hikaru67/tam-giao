import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, asc, eq, isNotNull, ne, sql, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { CandidateFinder, CandidatePool } from '../application/ports/candidate-finder.js';
import {
  CHILDREN_PLANS,
  CORE_TRAITS,
  DAILY_RHYTHMS,
  DRINKING_HABITS,
  EDUCATION_LEVELS,
  FINANCIAL_INDEPENDENCE,
  GENDERS,
  NOT_IMPORTANT,
  RELIGIONS,
  SMOKING_HABITS,
  SPORTS_HABITS,
  vnDate,
  type CandidateProfile,
  type Lifestyle,
} from '../domain/candidate-profile.js';
import { candidateProfiles } from './schema-candidates.js';
import { activeSlots, cooldowns, pairHistory } from './schema-slots.js';

type Row = typeof candidateProfiles.$inferSelect;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function oneOf<T extends string>(values: readonly T[], v: unknown, field: string, userId: string): T {
  if (typeof v === 'string' && (values as readonly string[]).includes(v)) return v as T;
  throw new Error(`matching.candidate_profiles ${userId}: ${field} không hợp lệ`);
}

/** Dòng read model (đã đồng bộ hồ sơ) → Value Object. Sai dạng là lỗi dữ liệu/lập trình → throw. */
export function toCandidateProfileFromRow(row: Row): CandidateProfile {
  const id = row.userId;
  const { birthDate, cityKey, prefAgeMin, prefAgeMax, scoring } = row;
  if (
    birthDate === null ||
    cityKey === null ||
    prefAgeMin === null ||
    prefAgeMax === null ||
    !isRecord(scoring)
  ) {
    throw new Error(`matching.candidate_profiles ${id}: chưa đồng bộ hồ sơ`);
  }
  const lifestyle = scoring['lifestyle'];
  const coreTraits = scoring['coreTraits'];
  if (!isRecord(lifestyle) || !Array.isArray(coreTraits)) {
    throw new Error(`matching.candidate_profiles ${id}: scoring không hợp lệ`);
  }
  const parsedLifestyle: Lifestyle = {
    smoking: oneOf(SMOKING_HABITS, lifestyle['smoking'], 'smoking', id),
    drinking: oneOf(DRINKING_HABITS, lifestyle['drinking'], 'drinking', id),
    dailyRhythm: oneOf(DAILY_RHYTHMS, lifestyle['dailyRhythm'], 'dailyRhythm', id),
    sports: oneOf(SPORTS_HABITS, lifestyle['sports'], 'sports', id),
  };
  return {
    userId: id,
    gender: oneOf(GENDERS, row.gender, 'gender', id),
    birthDate,
    cityKey,
    education: oneOf(EDUCATION_LEVELS, row.education, 'education', id),
    criteria: {
      ageMin: prefAgeMin,
      ageMax: prefAgeMax,
      cityKey: row.prefCityKey,
      childrenPlan: oneOf(CHILDREN_PLANS, row.childrenPlan, 'childrenPlan', id),
      religion: oneOf(RELIGIONS, row.religion, 'religion', id),
      minEducation:
        row.prefMinEducation === null
          ? null
          : oneOf(EDUCATION_LEVELS, row.prefMinEducation, 'prefMinEducation', id),
      lifestyle: parsedLifestyle,
      financialIndependence: oneOf(
        FINANCIAL_INDEPENDENCE,
        scoring['financialIndependence'],
        'financialIndependence',
        id,
      ),
      coreTraits: coreTraits.map((t) => oneOf(CORE_TRAITS, t, 'coreTraits', id)),
    },
  };
}

/**
 * `CandidateFinder` bằng một câu SQL trên read model (BE-S5-03): tự join `candidate_profiles` (s = người tìm,
 * c = ứng viên) và áp đúng luật `passesHardFilters` theo **cả hai chiều**, cộng các điều kiện loại:
 * chưa xác thực / chưa đồng bộ hồ sơ, đang bận (`active_slots`), đang cooldown (`cooldowns.until > now`),
 * đã thử cặp (`pair_history`, cặp chuẩn hoá `least/greatest`). Tuổi = `age(ngày VN hiện tại, birth_date)`, cùng
 * cách tính với `ageAt`. Giới tính: chỉ ghép khác giới.
 */
export class DrizzleCandidateFinder implements CandidateFinder {
  async find(tx: Tx, userId: string, limit: number, now: Date): Promise<CandidatePool | null> {
    const db = asDbTx(tx);
    const [seekerRow] = await db
      .select()
      .from(candidateProfiles)
      .where(and(eq(candidateProfiles.userId, userId), isNotNull(candidateProfiles.profileSyncedAt)));
    if (seekerRow === undefined) return null;
    if (limit <= 0) return { seeker: toCandidateProfileFromRow(seekerRow), candidates: [] };

    const s = alias(candidateProfiles, 's');
    const c = alias(candidateProfiles, 'c');
    const today = vnDate(now);
    const ageOf = (birth: SQLWrapper) => sql`extract(year from age(${today}::date, ${birth}))`;
    const flexibleChildren = sql.join(
      [NOT_IMPORTANT, 'open'].map((v) => sql`${v}`),
      sql`, `,
    );

    const rows = await db
      .select({ candidate: c })
      .from(s)
      .innerJoin(c, ne(c.userId, s.userId))
      .where(
        and(
          eq(s.userId, userId),
          eq(c.verified, true),
          isNotNull(c.profileSyncedAt),
          // Giới tính — chỉ ghép khác giới.
          ne(c.gender, s.gender),
          // Tuổi — hai chiều.
          sql`${ageOf(c.birthDate)} between ${s.prefAgeMin} and ${s.prefAgeMax}`,
          sql`${ageOf(s.birthDate)} between ${c.prefAgeMin} and ${c.prefAgeMax}`,
          // Khu vực — hai chiều (`null` = không giới hạn).
          sql`(${s.prefCityKey} is null or ${s.prefCityKey} = ${c.cityKey})`,
          sql`(${c.prefCityKey} is null or ${c.prefCityKey} = ${s.cityKey})`,
          // Tôn giáo, kế hoạch con cái — so khớp đối xứng.
          sql`(${s.religion} = ${NOT_IMPORTANT} or ${c.religion} = ${NOT_IMPORTANT} or ${s.religion} = ${c.religion})`,
          sql`(${s.childrenPlan} in (${flexibleChildren}) or ${c.childrenPlan} in (${flexibleChildren})
                or ${s.childrenPlan} = ${c.childrenPlan})`,
          // Loại người đang bận / cooldown / đã thử cặp.
          sql`not exists (select 1 from ${activeSlots} where ${activeSlots.userId} = ${c.userId})`,
          sql`not exists (select 1 from ${cooldowns} where ${cooldowns.userId} = ${c.userId} and ${cooldowns.until} > ${now})`,
          sql`not exists (select 1 from ${pairHistory}
                where ${pairHistory.userLow} = least(${s.userId}, ${c.userId})
                  and ${pairHistory.userHigh} = greatest(${s.userId}, ${c.userId}))`,
        ),
      )
      .orderBy(asc(c.userId))
      .limit(limit);

    return {
      seeker: toCandidateProfileFromRow(seekerRow),
      candidates: rows.map((r) => toCandidateProfileFromRow(r.candidate)),
    };
  }
}
