import { asDbTx } from '@tamgiao/db';
import { ok, type ObjectStorage, type UnitOfWork } from '@tamgiao/kernel';
import { and, eq, inArray } from 'drizzle-orm';
import type { DisplayPhoto, MatchDisplayProfile, MatchDisplayProfileOptions } from '../application/facade.js';
import { EDUCATION_LEVELS, GENDERS, type EducationLevel, type Gender } from '../domain/profile.js';
import { profiles } from './schema.js';

const isGender = (v: string | null): v is Gender => v !== null && (GENDERS as readonly string[]).includes(v);
const isEducation = (v: string | null): v is EducationLevel =>
  v !== null && (EDUCATION_LEVELS as readonly string[]).includes(v);

/**
 * Hiện thực `ProfileFacade.getMatchDisplayProfiles` (BE-S5-06). Module "mỏng" (A11): đọc thẳng `profile.profiles`,
 * **chỉ chọn cột công khai** — không đọc cột `*_enc` (thu nhập, nhà ở, tài sản) nên không cần `Encryptor`. Ảnh lấy
 * presigned GET bucket `publicProfile` (adapter cố định hạn `PRESIGNED_URL_TTL_SECONDS`).
 */
export class DrizzleMatchDisplayDirectory {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly storage: ObjectStorage,
  ) {}

  async getMatchDisplayProfiles(
    userIds: readonly string[],
    options: MatchDisplayProfileOptions = {},
  ): Promise<readonly MatchDisplayProfile[]> {
    if (userIds.length === 0) return [];
    const found = await this.uow.run(async (tx) =>
      ok(
        await asDbTx(tx)
          .select({
            userId: profiles.userId,
            fullName: profiles.fullName,
            gender: profiles.gender,
            birthDate: profiles.birthDate,
            currentCity: profiles.currentCity,
            education: profiles.education,
            occupation: profiles.occupation,
            bio: profiles.bio,
            interests: profiles.interests,
            photoKeys: profiles.photoKeys,
          })
          .from(profiles)
          .where(and(inArray(profiles.userId, [...new Set(userIds)]), eq(profiles.status, 'COMPLETED'))),
      ),
    );
    const rows = found.unwrapOr([]);
    const onlyPrimary = options.photos === 'primary';

    return Promise.all(
      rows.map(async (row): Promise<MatchDisplayProfile> => {
        const { fullName, gender, birthDate, currentCity, education, occupation } = row;
        // Hồ sơ COMPLETED luôn đủ trường bắt buộc (domain `Profile.update`) — thiếu là lỗi dữ liệu.
        if (
          fullName === null ||
          !isGender(gender) ||
          birthDate === null ||
          currentCity === null ||
          !isEducation(education) ||
          occupation === null
        ) {
          throw new Error(`profile ${row.userId}: hồ sơ COMPLETED thiếu trường bắt buộc`);
        }
        const keys = onlyPrimary ? row.photoKeys.slice(0, 1) : row.photoKeys;
        const photos = await Promise.all(
          keys.map(async (key): Promise<DisplayPhoto> => {
            const signed = await this.storage.presignGet({ bucket: 'publicProfile', key });
            return { url: signed.url, expiresAt: signed.expiresAt };
          }),
        );
        return {
          userId: row.userId,
          fullName,
          gender,
          birthDate,
          currentCity,
          education,
          occupation,
          bio: row.bio,
          interests: row.interests,
          photos,
        };
      }),
    );
  }
}
