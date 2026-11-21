import { timestamptz } from '@tamgiao/db';
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { matching } from './schema-base.js';

/**
 * Read model hồ sơ ứng viên (BE-S5-03) — bản sao những gì matching cần từ module profile (A3: không đọc bảng
 * `profile.*`), đồng bộ qua event `ProfileCompleted` / `ProfileUpdated` / `PreferencesUpdated` (đọc lại facade profile) và
 * `KycApproved` / `KycRejected` (cờ `verified`). Không chứa họ tên, ảnh, tự bạch hay dữ liệu mã hoá (thu nhập, nhà ở,
 * tài sản). Phần hồ sơ `null` khi mới có cờ `verified` mà chưa đồng bộ hồ sơ — `CandidateFinder` bỏ qua dòng đó.
 *
 * Cột lọc cứng tách riêng để lọc bằng SQL; phần chỉ dùng chấm điểm ở jsonb `scoring`
 * (`{ lifestyle, financialIndependence, coreTraits }`). `city_key`/`pref_city_key` là tên thành phố đã chuẩn hoá
 * (`cityKey` của domain).
 */
export const candidateProfiles = matching.table(
  'candidate_profiles',
  {
    userId: uuid('user_id').primaryKey(),
    verified: boolean('verified').notNull().default(false),
    gender: text('gender'),
    birthDate: date('birth_date', { mode: 'string' }),
    cityKey: text('city_key'),
    education: text('education'),
    /** **Tiêu chí** kế hoạch con cái (lọc cứng so với `own_children_plan` của người kia; chấm điểm đối xứng). */
    childrenPlan: text('children_plan'),
    /** **Tiêu chí** tôn giáo (lọc cứng so với `own_religion` của người kia; chấm điểm đối xứng). */
    religion: text('religion'),
    /**
     * Tôn giáo / kế hoạch con cái **của chính người đó** (hồ sơ, BE-S6-07). `null` = hồ sơ hoàn tất trước BE-S6-07,
     * chưa khai → không bị loại vì tiêu chí tương ứng của người khác. Nằm ngoài CHECK `num_nulls` (được phép null khi
     * phần hồ sơ đã đồng bộ).
     */
    ownReligion: text('own_religion'),
    ownChildrenPlan: text('own_children_plan'),
    prefAgeMin: integer('pref_age_min'),
    prefAgeMax: integer('pref_age_max'),
    /** `null` = không giới hạn khu vực. */
    prefCityKey: text('pref_city_key'),
    prefMinEducation: text('pref_min_education'),
    scoring: jsonb('scoring'),
    /** Version nguồn (`profile.profiles` / `profile.preferences`) của bản đang lưu — chỉ nhận bản mới hơn. */
    profileVersion: integer('profile_version'),
    preferencesVersion: integer('preferences_version'),
    profileSyncedAt: timestamptz('profile_synced_at'),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    // Phần hồ sơ đồng bộ nguyên khối: hoặc đủ hết, hoặc chưa có gì.
    check(
      'candidate_profiles_profile_complete_ck',
      sql`num_nulls(${t.profileSyncedAt}, ${t.gender}, ${t.birthDate}, ${t.cityKey}, ${t.education}, ${t.childrenPlan},
        ${t.religion}, ${t.prefAgeMin}, ${t.prefAgeMax}, ${t.scoring}, ${t.profileVersion}, ${t.preferencesVersion})
        in (0, 12)`,
    ),
    check('candidate_profiles_gender_ck', sql`${t.gender} in ('male', 'female')`),
    check(
      'candidate_profiles_education_ck',
      sql`${t.education} in ('high_school', 'college', 'bachelor', 'master', 'doctorate')`,
    ),
    check(
      'candidate_profiles_pref_min_education_ck',
      sql`${t.prefMinEducation} in ('high_school', 'college', 'bachelor', 'master', 'doctorate')`,
    ),
    check(
      'candidate_profiles_children_plan_ck',
      sql`${t.childrenPlan} in ('want_children', 'no_children', 'open', 'not_important')`,
    ),
    check(
      'candidate_profiles_religion_ck',
      sql`${t.religion} in ('none', 'buddhism', 'catholicism', 'protestantism', 'caodaism', 'hoa_hao', 'other', 'not_important')`,
    ),
    check(
      'candidate_profiles_own_religion_ck',
      sql`${t.ownReligion} in ('none', 'buddhism', 'catholicism', 'protestantism', 'caodaism', 'hoa_hao', 'other')`,
    ),
    check(
      'candidate_profiles_own_children_plan_ck',
      sql`${t.ownChildrenPlan} in ('want_children', 'no_children', 'open')`,
    ),
    check('candidate_profiles_pref_age_ck', sql`${t.prefAgeMin} <= ${t.prefAgeMax}`),
    // Lọc nhanh ứng viên đã xác thực, đủ hồ sơ.
    index('candidate_profiles_ready_idx')
      .on(t.birthDate)
      .where(sql`${t.verified} and ${t.profileSyncedAt} is not null`),
  ],
);
