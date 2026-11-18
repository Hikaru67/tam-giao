import { ok, type Clock, type ObjectStorage, type Result, type UnitOfWork } from '@tamgiao/kernel';
import type { BillingFacade } from '@tamgiao/module-billing/facade';
import type { VerificationFacade } from '@tamgiao/module-verification/facade';
import { onboardingStep, type OnboardingStep } from '../domain/onboarding.js';
import { ageAt, type Gender } from '../domain/profile.js';
import type { PreferencesRepository } from './ports/preferences-repository.js';
import type { ProfileRepository } from './ports/profile-repository.js';

export interface MeView {
  readonly userId: string;
  readonly onboardingStep: OnboardingStep;
  readonly profile: {
    readonly fullName: string | null;
    readonly gender: Gender | null;
    readonly age: number | null;
    readonly currentCity: string | null;
    readonly avatarUrl: string | null;
  } | null;
  readonly badges: readonly string[];
  /** Đã thanh toán xác thực (BE-S4-03) — app chọn CTA thanh toán hay thẻ "Đã ghi nhận". */
  readonly verificationPaid: boolean;
}

export interface GetMeDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly profiles: ProfileRepository;
  readonly preferences: PreferencesRepository;
  readonly storage: ObjectStorage;
  /** Trạng thái xác thực + huy hiệu (facade verification, BE-S3-07). */
  readonly verification: Pick<VerificationFacade, 'getSummary'>;
  /** Trạng thái thanh toán xác thực (facade billing, BE-S4-03). */
  readonly billing: Pick<BillingFacade, 'hasPaidVerification'>;
}

/**
 * `GET /me`: thông tin cơ bản + bước onboarding + huy hiệu + đã thanh toán xác thực chưa để app điều hướng
 * (BE-S2-08, BE-S3-07, BE-S4-03).
 */
export class GetMe {
  constructor(private readonly deps: GetMeDeps) {}

  async execute(userId: string): Promise<Result<MeView, never>> {
    const { uow, clock, profiles, preferences, storage, verification, billing } = this.deps;
    const loaded = await uow.run(async (tx) =>
      ok({
        profile: await profiles.findById(tx, userId),
        hasPreferences: (await preferences.findById(tx, userId)) !== null,
      }),
    );
    const { profile, hasPreferences } = loaded.unwrapOr({ profile: null, hasPreferences: false });
    const state = profile?.toState() ?? null;
    const [verificationSummary, verificationPaid] = await Promise.all([
      verification.getSummary(userId),
      billing.hasPaidVerification(userId),
    ]);

    let view: MeView['profile'] = null;
    if (state) {
      const d = state.data;
      const avatarKey = d.photos[0];
      view = {
        fullName: d.fullName,
        gender: d.gender,
        age: d.birthDate === null ? null : ageAt(d.birthDate, clock.now()),
        currentCity: d.currentCity,
        avatarUrl:
          avatarKey === undefined
            ? null
            : (await storage.presignGet({ bucket: 'publicProfile', key: avatarKey })).url,
      };
    }

    return ok({
      userId,
      onboardingStep: onboardingStep({
        profileStatus: state?.status ?? null,
        hasPreferences,
        verification: verificationSummary.status,
        verificationPaid,
      }),
      profile: view,
      badges: verificationSummary.badges,
      verificationPaid,
    });
  }
}
