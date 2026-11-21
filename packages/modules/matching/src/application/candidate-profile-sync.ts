import type { Clock, Tx } from '@tamgiao/kernel';
import type { MatchingProfile, ProfileFacade } from '@tamgiao/module-profile/facade';
import { cityKey, type CandidateProfile } from '../domain/candidate-profile.js';
import type { CandidateProfileRepository } from './ports/candidate-profile-repository.js';

/** Map dữ liệu facade profile → Value Object của matching (chuẩn hoá thành phố thành khoá so khớp). */
export function toCandidateProfile(p: MatchingProfile): CandidateProfile {
  const c = p.criteria;
  return {
    userId: p.userId,
    gender: p.gender,
    birthDate: p.birthDate,
    cityKey: cityKey(p.currentCity),
    education: p.education,
    religion: p.religion,
    childrenPlan: p.childrenPlan,
    criteria: {
      ageMin: c.ageMin,
      ageMax: c.ageMax,
      cityKey: c.areaCity === null ? null : cityKey(c.areaCity),
      childrenPlan: c.childrenPlan,
      religion: c.religion,
      minEducation: c.minEducation,
      lifestyle: { ...c.lifestyle },
      financialIndependence: c.financialIndependence,
      coreTraits: [...c.coreTraits],
    },
  };
}

/**
 * Đồng bộ phần hồ sơ/tiêu chí của read model khi nhận `ProfileCompleted` / `ProfileUpdated` /
 * `PreferencesUpdated` (BE-S5-03, BE-S6-07).
 * Luôn đọc lại trạng thái **hiện tại** qua facade profile (payload event chỉ có `userId`) → chạy lại / sai thứ tự
 * không đổi kết quả (A9). Chưa đủ hồ sơ + tiêu chí → bỏ qua (event còn lại sẽ đồng bộ sau).
 */
export class SyncCandidateProfile {
  constructor(
    private readonly deps: {
      readonly clock: Clock;
      readonly profiles: Pick<ProfileFacade, 'getMatchingProfile'>;
      readonly candidates: CandidateProfileRepository;
    },
  ) {}

  async handle(tx: Tx, cmd: { readonly userId: string }): Promise<void> {
    const found = await this.deps.profiles.getMatchingProfile(cmd.userId);
    if (found === null) return;
    await this.deps.candidates.upsertProfile(
      tx,
      {
        profile: toCandidateProfile(found),
        profileVersion: found.profileVersion,
        preferencesVersion: found.preferencesVersion,
      },
      this.deps.clock.now(),
    );
  }
}

/**
 * Cập nhật cờ `verified` của read model: `KycApproved` → `true`, `KycRejected` → `false` (BE-S5-03). Hai trạng thái
 * này là trạng thái cuối của hồ sơ eKYC (không quay lại) nên lấy thẳng từ event là chính xác; đặt lại cùng giá trị
 * là idempotent.
 */
export class SetCandidateVerification {
  constructor(
    private readonly deps: { readonly clock: Clock; readonly candidates: CandidateProfileRepository },
  ) {}

  async handle(tx: Tx, cmd: { readonly userId: string; readonly verified: boolean }): Promise<void> {
    await this.deps.candidates.setVerified(tx, cmd.userId, cmd.verified, this.deps.clock.now());
  }
}
