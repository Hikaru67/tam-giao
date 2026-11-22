import { ACCOUNT_DELETION_REQUESTED } from '@tamgiao/contracts';
import { asDbTx, type EventBus } from '@tamgiao/db';
import type { DomainEvent, Encryptor, ObjectStorage, Tx } from '@tamgiao/kernel';
import type { PersonalDataSection, PersonalDataSource } from '@tamgiao/module-identity/facade';
import { eq } from 'drizzle-orm';
import { preferences, profiles } from './schema.js';

/**
 * Quyền dữ liệu cá nhân của module profile (BE-S7-06): consumer xoá dữ liệu khi người dùng xoá tài khoản + nguồn dữ
 * liệu cho file xuất. Profile là module "mỏng" (A11) nên thao tác thẳng trên bảng của mình.
 */

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const PROFILE_ERASE_ON_ACCOUNT_DELETION_CONSUMER = 'profile.erase-on-account-deletion';

function userIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.length > 0) return userId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
}

/**
 * `AccountDeletionRequested` → xoá ảnh hồ sơ trên storage (bucket `publicProfile`) rồi xoá hẳn hồ sơ + tiêu chí bạn đời
 * (họ tên, ngày sinh, tôn giáo, thu nhập/nhà ở/tài sản mã hoá…). Idempotent (A9): không còn dòng → không làm gì; xoá
 * object storage không lỗi khi object đã mất. Chạy trong tx của `deliverOnce` — lỗi storage → throw, thử lại.
 */
export function registerProfileAccountDeletionConsumer(
  bus: EventBus,
  deps: { readonly storage: ObjectStorage },
): void {
  bus.on(ACCOUNT_DELETION_REQUESTED, PROFILE_ERASE_ON_ACCOUNT_DELETION_CONSUMER, async (event, tx) => {
    const userId = userIdOf(event);
    const db = asDbTx(tx);
    const [row] = await db
      .select({ photoKeys: profiles.photoKeys })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .for('update');
    for (const key of row?.photoKeys ?? []) await deps.storage.delete('publicProfile', key);
    await db.delete(profiles).where(eq(profiles.userId, userId));
    await db.delete(preferences).where(eq(preferences.userId, userId));
  });
}

const decryptOrNull = async (
  encryptor: Encryptor,
  value: Uint8Array | null,
  context: string,
): Promise<string | null> => (value === null ? null : encryptor.decrypt(value, context));

/** Mục `profile` của file xuất: toàn bộ hồ sơ (kể cả thu nhập/nhà ở/tài sản giải mã), tiêu chí bạn đời, ảnh hồ sơ. */
export function createProfilePersonalDataSource(encryptor: Encryptor): PersonalDataSource {
  return {
    section: 'profile',
    async collect(tx: Tx, userId: string): Promise<PersonalDataSection> {
      const db = asDbTx(tx);
      const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
      const [pref] = await db.select().from(preferences).where(eq(preferences.userId, userId));
      return {
        data: {
          profile: p
            ? {
                fullName: p.fullName,
                birthDate: p.birthDate,
                gender: p.gender,
                hometown: p.hometown,
                currentCity: p.currentCity,
                education: p.education,
                occupation: p.occupation,
                religion: p.religion,
                childrenPlan: p.childrenPlan,
                bio: p.bio,
                interests: p.interests,
                incomeRange: await decryptOrNull(
                  encryptor,
                  p.incomeRangeEnc,
                  `profile.profiles.income_range:${userId}`,
                ),
                housing: await decryptOrNull(encryptor, p.housingEnc, `profile.profiles.housing:${userId}`),
                assets: await decryptOrNull(encryptor, p.assetsEnc, `profile.profiles.assets:${userId}`),
                status: p.status,
                completedAt: p.completedAt?.toISOString() ?? null,
                createdAt: p.createdAt.toISOString(),
                updatedAt: p.updatedAt.toISOString(),
              }
            : null,
          preferences: pref
            ? {
                ageMin: pref.ageMin,
                ageMax: pref.ageMax,
                areaCity: pref.areaCity,
                areaRadiusKm: pref.areaRadiusKm,
                childrenPlan: pref.childrenPlan,
                religion: pref.religion,
                minEducation: pref.minEducation,
                details: pref.details,
                updatedAt: pref.updatedAt.toISOString(),
              }
            : null,
        },
        files: (p?.photoKeys ?? []).map((key, i) => ({
          bucket: 'publicProfile' as const,
          key,
          label: `profile_photo_${i + 1}`,
        })),
      };
    },
  };
}
