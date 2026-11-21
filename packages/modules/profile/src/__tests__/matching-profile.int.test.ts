import { createDatabase, DrizzleUnitOfWork, type Database } from '@tamgiao/db';
import { newId } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProfileFacade } from '../application/facade.js';
import { createMatchingProfileReader } from '../index.js';

let database: Database;
let reader: Pick<ProfileFacade, 'getMatchingProfile'>;
const T = new Date('2026-11-18T01:00:00.000Z');

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 5 });
  reader = createMatchingProfileReader({ uow: new DrizzleUnitOfWork(database.pool) });
});
beforeEach(() => resetDatabase(database.pool));
afterAll(() => database.close());

async function insertProfile(userId: string, status: 'DRAFT' | 'COMPLETED'): Promise<void> {
  await database.pool.query(
    `insert into profile.profiles
       (user_id, full_name, birth_date, gender, current_city, education, occupation, interests, income_range_enc,
        photo_keys, status, completed_at, created_at, updated_at, version)
     values ($1, 'Nguyễn Văn A', '1995-04-10', 'male', 'Đà Nẵng', 'bachelor', 'Kỹ sư', '{}', '\\x01',
             '{k1}', $2, $3, $4, $4, 3)`,
    [userId, status, status === 'COMPLETED' ? T : null, T],
  );
}

async function insertPreferences(userId: string): Promise<void> {
  await database.pool.query(
    `insert into profile.preferences
       (user_id, age_min, age_max, area_city, area_radius_km, children_plan, religion, min_education, details,
        created_at, updated_at, version)
     values ($1, 24, 32, 'Đà Nẵng', null, 'want_children', 'buddhism', 'college', $2, $3, $3, 2)`,
    [
      userId,
      JSON.stringify({
        lifestyle: {
          smoking: 'never',
          drinking: 'occasionally',
          dailyRhythm: 'night_owl',
          sports: 'not_important',
        },
        financialIndependence: 'preferred',
        coreTraits: ['honest', 'loyal', 'patient'],
      }),
      T,
    ],
  );
}

describe('ProfileFacade.getMatchingProfile (BE-S5-03)', () => {
  it('hồ sơ đã hoàn tất + có tiêu chí → dữ liệu matching, không có họ tên / dữ liệu mã hoá', async () => {
    const u = newId();
    await insertProfile(u, 'COMPLETED');
    await insertPreferences(u);
    const got = await reader.getMatchingProfile(u);
    expect(got).toEqual({
      userId: u,
      gender: 'male',
      birthDate: '1995-04-10',
      currentCity: 'Đà Nẵng',
      education: 'bachelor',
      // Hồ sơ cũ (trước BE-S6-07) chưa khai → null.
      religion: null,
      childrenPlan: null,
      criteria: {
        ageMin: 24,
        ageMax: 32,
        areaCity: 'Đà Nẵng',
        areaRadiusKm: null,
        childrenPlan: 'want_children',
        religion: 'buddhism',
        minEducation: 'college',
        lifestyle: {
          smoking: 'never',
          drinking: 'occasionally',
          dailyRhythm: 'night_owl',
          sports: 'not_important',
        },
        financialIndependence: 'preferred',
        coreTraits: ['honest', 'loyal', 'patient'],
      },
      profileVersion: 3,
      preferencesVersion: 2,
    });
  });

  it('trả tôn giáo / kế hoạch con cái của chính người dùng (BE-S6-07)', async () => {
    const u = newId();
    await insertProfile(u, 'COMPLETED');
    await database.pool.query(
      `update profile.profiles set religion = 'catholicism', children_plan = 'no_children' where user_id = $1`,
      [u],
    );
    await insertPreferences(u);
    expect(await reader.getMatchingProfile(u)).toMatchObject({
      religion: 'catholicism',
      childrenPlan: 'no_children',
      criteria: { religion: 'buddhism', childrenPlan: 'want_children' },
    });
  });

  it('hồ sơ nháp, chưa có tiêu chí, hoặc không có hồ sơ → null', async () => {
    const draft = newId();
    await insertProfile(draft, 'DRAFT');
    await insertPreferences(draft);
    const noPrefs = newId();
    await insertProfile(noPrefs, 'COMPLETED');
    expect(await reader.getMatchingProfile(draft)).toBeNull();
    expect(await reader.getMatchingProfile(noPrefs)).toBeNull();
    expect(await reader.getMatchingProfile(newId())).toBeNull();
  });
});
