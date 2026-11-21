import type { CandidateProfile, PartnerCriteria } from '../domain/candidate-profile.js';

/** Mốc thời gian cố định cho test: 2026-11-18 08:00 giờ Việt Nam. */
export const NOW = new Date('2026-11-18T01:00:00.000Z');

/** Ngày sinh để tròn `age` tuổi tại `NOW` (sinh nhật đã qua trong năm). */
export const bornAged = (age: number): string => `${2026 - age}-01-15`;

export const baseCriteria: PartnerCriteria = {
  ageMin: 25,
  ageMax: 35,
  cityKey: null,
  childrenPlan: 'want_children',
  religion: 'not_important',
  minEducation: null,
  lifestyle: { smoking: 'never', drinking: 'occasionally', dailyRhythm: 'early_bird', sports: 'regularly' },
  financialIndependence: 'preferred',
  coreTraits: ['honest', 'kind', 'responsible'],
};

export function candidate(
  userId: string,
  over: Partial<Omit<CandidateProfile, 'criteria'>> & { readonly criteria?: Partial<PartnerCriteria> } = {},
): CandidateProfile {
  const { criteria, ...rest } = over;
  return {
    userId,
    gender: 'female',
    birthDate: bornAged(30),
    cityKey: 'hà nội',
    education: 'bachelor',
    ...rest,
    criteria: { ...baseCriteria, ...criteria },
  };
}
