import { DrizzleUnitOfWork, createDatabase, type Database } from '@tamgiao/db';
import { newId } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleApplicantDirectory } from '../infrastructure/drizzle-applicant-directory.js';

let database: Database;
let directory: DrizzleApplicantDirectory;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
  directory = new DrizzleApplicantDirectory(new DrizzleUnitOfWork(database.pool));
});
beforeEach(() => resetDatabase(database.pool));
afterAll(() => database.close());

async function insertProfile(fullName: string | null, occupation: string | null): Promise<string> {
  const userId = newId<'User'>();
  await database.pool.query(
    `insert into profile.profiles (user_id, full_name, occupation, interests, photo_keys, status, created_at, updated_at, version)
     values ($1, $2, $3, '{}', '{}', 'DRAFT', now(), now(), 0)`,
    [userId, fullName, occupation],
  );
  return userId;
}

describe('DrizzleApplicantDirectory (facade profile cho duyệt eKYC)', () => {
  it('tìm theo họ tên hoặc nghề nghiệp, không phân biệt hoa/thường', async () => {
    const an = await insertProfile('Nguyễn Văn An', 'Kỹ sư phần mềm');
    const binh = await insertProfile('Trần Thị Bình', 'Giáo viên');
    await insertProfile(null, null);

    expect(await directory.searchUserIds('NGUYỄN', 10)).toEqual([an]);
    expect(await directory.searchUserIds('giáo', 10)).toEqual([binh]);
    expect([...(await directory.searchUserIds('n', 10))].sort()).toEqual([an, binh].sort());
    expect(await directory.searchUserIds('n', 1)).toHaveLength(1);
    expect(await directory.searchUserIds('   ', 10)).toEqual([]);
  });

  it('ký tự đại diện của LIKE được coi là chữ thường', async () => {
    await insertProfile('Lê Minh', 'Bác sĩ');
    const pct = await insertProfile('100% Nguyên', null);
    expect(await directory.searchUserIds('%', 10)).toEqual([pct]);
    expect(await directory.searchUserIds('_', 10)).toEqual([]);
  });

  it('tóm tắt nhiều người dùng; người chưa có hồ sơ bị bỏ qua', async () => {
    const an = await insertProfile('Nguyễn Văn An', 'Kỹ sư');
    const summaries = await directory.getApplicantSummaries([an, newId<'User'>(), an]);
    expect(summaries).toEqual([{ userId: an, fullName: 'Nguyễn Văn An', occupation: 'Kỹ sư' }]);
    expect(await directory.getApplicantSummaries([])).toEqual([]);
  });
});
