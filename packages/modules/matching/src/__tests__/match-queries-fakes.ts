import type { ApplicantSummary, MatchDisplayProfile } from '@tamgiao/module-profile/facade';
import type { MatchDisplayDirectory } from '../application/queries/match-query-support.js';

/** Hồ sơ hiển thị mẫu (facade profile giả) — `photos` là URL giả theo `userId`. */
export function displayProfile(
  userId: string,
  over: Partial<Omit<MatchDisplayProfile, 'userId'>> = {},
): MatchDisplayProfile {
  return {
    userId,
    fullName: 'Nguyễn Minh Trang',
    gender: 'female',
    birthDate: '1998-03-02',
    currentCity: 'TP. Hồ Chí Minh',
    education: 'master',
    occupation: 'Kiểm toán viên',
    bio: 'Tự bạch',
    interests: ['chạy bộ'],
    photos: [
      { url: `https://storage.test/${userId}/1.jpg`, expiresAt: new Date('2026-11-18T01:05:00.000Z') },
      { url: `https://storage.test/${userId}/2.jpg`, expiresAt: new Date('2026-11-18T01:05:00.000Z') },
    ],
    ...over,
  };
}

/** Facade profile giả cho query matching: trả hồ sơ đã nạp, tôn trọng `photos: 'primary'`, ghi lại lời gọi. */
export class FakeMatchDisplayDirectory implements MatchDisplayDirectory {
  readonly profiles = new Map<string, MatchDisplayProfile>();
  readonly displayCalls: { userIds: readonly string[]; photos: 'all' | 'primary' | undefined }[] = [];

  add(profile: MatchDisplayProfile): void {
    this.profiles.set(profile.userId, profile);
  }

  async getMatchDisplayProfiles(
    userIds: readonly string[],
    options?: { readonly photos?: 'all' | 'primary' },
  ): Promise<readonly MatchDisplayProfile[]> {
    this.displayCalls.push({ userIds: [...userIds], photos: options?.photos });
    return [...new Set(userIds)].flatMap((id) => {
      const p = this.profiles.get(id);
      if (!p) return [];
      return [options?.photos === 'primary' ? { ...p, photos: p.photos.slice(0, 1) } : p];
    });
  }

  async getApplicantSummaries(userIds: readonly string[]): Promise<readonly ApplicantSummary[]> {
    return [...new Set(userIds)].flatMap((id) => {
      const p = this.profiles.get(id);
      return p ? [{ userId: id, fullName: p.fullName, occupation: p.occupation }] : [];
    });
  }
}
