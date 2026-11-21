import { DrizzleUnitOfWork, createDatabase, type Database } from '@tamgiao/db';
import { newId, type ObjectStorage } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleMatchDisplayDirectory } from '../infrastructure/drizzle-match-display-directory.js';

let database: Database;
let directory: DrizzleMatchDisplayDirectory;
const T = new Date('2026-11-18T01:00:00.000Z');
const EXPIRES = new Date('2026-11-18T01:05:00.000Z');
const signed: { bucket: string; key: string }[] = [];

const storage: ObjectStorage = {
  presignPut: async () => {
    throw new Error('không dùng');
  },
  presignGet: async (i) => {
    signed.push({ bucket: i.bucket, key: i.key });
    return { url: `https://storage.test/get/${i.key}`, method: 'GET', headers: {}, expiresAt: EXPIRES };
  },
  head: async () => null,
  delete: async () => undefined,
};

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
  directory = new DrizzleMatchDisplayDirectory(new DrizzleUnitOfWork(database.pool), storage);
});
beforeEach(async () => {
  signed.length = 0;
  await resetDatabase(database.pool);
});
afterAll(() => database.close());

async function insertProfile(status: 'DRAFT' | 'COMPLETED', photos: string[]): Promise<string> {
  const userId = newId<'User'>();
  await database.pool.query(
    `insert into profile.profiles
       (user_id, full_name, birth_date, gender, hometown, current_city, education, occupation, bio, interests,
        income_range_enc, housing_enc, assets_enc, photo_keys, status, completed_at, created_at, updated_at, version)
     values ($1, 'Nguyễn Minh Trang', '1998-03-02', 'female', 'Huế', 'TP. Hồ Chí Minh', 'master', 'Kiểm toán viên',
             'Tự bạch', '{chạy bộ,đọc sách}', '\\x01', '\\x02', '\\x03', $2, $3, $4, $5, $5, 2)`,
    [userId, photos, status, status === 'COMPLETED' ? T : null, T],
  );
  return userId;
}

describe('DrizzleMatchDisplayDirectory (facade profile cho màn ghép đôi, BE-S5-06)', () => {
  it('chỉ phần công khai của hồ sơ COMPLETED + presigned GET ảnh hồ sơ; không có trường riêng tư', async () => {
    const u = await insertProfile('COMPLETED', ['profile_photo/a/1.jpg', 'profile_photo/a/2.jpg']);
    const [got, ...rest] = await directory.getMatchDisplayProfiles([u, u]);
    expect(rest).toEqual([]);
    expect(got).toEqual({
      userId: u,
      fullName: 'Nguyễn Minh Trang',
      gender: 'female',
      birthDate: '1998-03-02',
      currentCity: 'TP. Hồ Chí Minh',
      education: 'master',
      occupation: 'Kiểm toán viên',
      bio: 'Tự bạch',
      interests: ['chạy bộ', 'đọc sách'],
      photos: [
        { url: 'https://storage.test/get/profile_photo/a/1.jpg', expiresAt: EXPIRES },
        { url: 'https://storage.test/get/profile_photo/a/2.jpg', expiresAt: EXPIRES },
      ],
    });
    // `toEqual` ở trên đã so khớp đúng tập khoá; kiểm tra tường minh không lộ trường riêng tư / quê quán dù DB có.
    for (const key of ['incomeRange', 'housing', 'assets', 'hometown']) expect(got).not.toHaveProperty(key);
    expect(signed.every((s) => s.bucket === 'publicProfile')).toBe(true);
  });

  it("`photos: 'primary'` chỉ ký ảnh đại diện", async () => {
    const u = await insertProfile('COMPLETED', ['profile_photo/a/1.jpg', 'profile_photo/a/2.jpg']);
    const [got] = await directory.getMatchDisplayProfiles([u], { photos: 'primary' });
    expect(got?.photos).toEqual([
      { url: 'https://storage.test/get/profile_photo/a/1.jpg', expiresAt: EXPIRES },
    ]);
    expect(signed).toHaveLength(1);
  });

  it('hồ sơ nháp / không tồn tại bị bỏ qua; danh sách rỗng → rỗng', async () => {
    const draft = await insertProfile('DRAFT', []);
    expect(await directory.getMatchDisplayProfiles([draft, newId<'User'>()])).toEqual([]);
    expect(await directory.getMatchDisplayProfiles([])).toEqual([]);
  });
});
