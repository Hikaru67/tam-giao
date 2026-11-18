import { bytea, timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { check, date, integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';

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
