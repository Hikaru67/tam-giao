import { bytea, timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, pgSchema, text, uuid } from 'drizzle-orm/pg-core';

/** Schema Postgres của module profile (AGENTS.md mục 4). */
export const profile = pgSchema('profile');

export const profiles = profile.table(
  'profiles',
  {
    userId: uuid('user_id').primaryKey(),
    fullName: text('full_name'),
    birthDate: date('birth_date', { mode: 'string' }),
    gender: text('gender'),
    hometown: text('hometown'),
    currentCity: text('current_city'),
    education: text('education'),
    occupation: text('occupation'),
    bio: text('bio'),
    interests: text('interests').array().notNull(),
    /** Mức thu nhập, mã hoá qua `Encryptor` (context `profile.profiles.income_range:<userId>`). */
    incomeRangeEnc: bytea('income_range_enc'),
    /** Tình trạng nhà ở, mã hoá qua `Encryptor` (context `profile.profiles.housing:<userId>`). */
    housingEnc: bytea('housing_enc'),
    /** Tài sản, mã hoá qua `Encryptor` (context `profile.profiles.assets:<userId>`). */
    assetsEnc: bytea('assets_enc'),
    photoKeys: text('photo_keys').array().notNull(),
    status: text('status').notNull(),
    completedAt: timestamptz('completed_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    check('profiles_gender_ck', sql`${t.gender} in ('male', 'female')`),
    check(
      'profiles_education_ck',
      sql`${t.education} in ('high_school', 'college', 'bachelor', 'master', 'doctorate')`,
    ),
    check('profiles_status_ck', sql`${t.status} in ('DRAFT', 'COMPLETED')`),
    check('profiles_photo_keys_ck', sql`cardinality(${t.photoKeys}) <= 5`),
    check('profiles_bio_ck', sql`char_length(${t.bio}) <= 800`),
  ],
);

/**
 * Tiêu chí bạn đời (BE-S2-06). Bộ lọc cứng là cột riêng để matching (BE-S5-03) lọc bằng SQL; phần mềm ở jsonb
 * `details`. CHECK tuổi không ghi cứng `MIN_AGE` (còn chờ D6) — domain kiểm tra cận dưới.
 */
export const preferences = profile.table(
  'preferences',
  {
    userId: uuid('user_id').primaryKey(),
    ageMin: integer('age_min').notNull(),
    ageMax: integer('age_max').notNull(),
    areaCity: text('area_city'),
    areaRadiusKm: integer('area_radius_km'),
    childrenPlan: text('children_plan').notNull(),
    religion: text('religion').notNull(),
    minEducation: text('min_education'),
    details: jsonb('details').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    check('preferences_age_ck', sql`${t.ageMin} >= 1 and ${t.ageMax} <= 80 and ${t.ageMin} <= ${t.ageMax}`),
    check('preferences_radius_ck', sql`${t.areaRadiusKm} is null or (${t.areaRadiusKm} between 1 and 500)`),
    check(
      'preferences_children_plan_ck',
      sql`${t.childrenPlan} in ('want_children', 'no_children', 'open', 'not_important')`,
    ),
    check(
      'preferences_religion_ck',
      sql`${t.religion} in ('none', 'buddhism', 'catholicism', 'protestantism', 'caodaism', 'hoa_hao', 'other', 'not_important')`,
    ),
    check(
      'preferences_min_education_ck',
      sql`${t.minEducation} is null or ${t.minEducation} in ('high_school', 'college', 'bachelor', 'master', 'doctorate')`,
    ),
    index('preferences_age_idx').on(t.ageMin, t.ageMax),
  ],
);
