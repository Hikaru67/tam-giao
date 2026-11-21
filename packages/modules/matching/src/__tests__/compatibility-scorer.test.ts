import { describe, expect, it } from 'vitest';
import {
  CHILDREN_PLANS,
  CORE_TRAITS,
  DAILY_RHYTHMS,
  EDUCATION_LEVELS,
  RELIGIONS,
  SMOKING_HABITS,
  type CandidateProfile,
} from '../domain/candidate-profile.js';
import { CompatibilityScorer } from '../domain/compatibility-scorer.js';
import { COMPATIBILITY_PILLARS, DEFAULT_COMPATIBILITY_WEIGHTS } from '../domain/compatibility-weights.js';
import { bornAged, candidate, NOW } from './candidate-fixtures.js';

const scorer = new CompatibilityScorer();
const A = candidate('a');

describe('CompatibilityScorer — bảng case (AC2)', () => {
  it.each<{
    name: string;
    a?: CandidateProfile;
    b: CandidateProfile;
    total: number;
    pillars: [number, number, number];
    commonPoints: string[];
  }>([
    {
      name: 'hồ sơ giống hệt',
      b: candidate('b'),
      total: 94,
      pillars: [85, 100, 100],
      commonPoints: [
        'SAME_CHILDREN_PLAN',
        'SAME_CITY',
        'SHARED_TRAIT_HONEST',
        'SHARED_TRAIT_KIND',
        'SHARED_TRAIT_RESPONSIBLE',
        'SAME_SMOKING',
        'SAME_DRINKING',
        'SAME_DAILY_RHYTHM',
        'SAME_SPORTS',
        'SAME_FINANCIAL_VIEW',
      ],
    },
    {
      name: 'trung bình (một phần khớp)',
      b: candidate('b', {
        birthDate: bornAged(34),
        cityKey: 'hồ chí minh',
        criteria: {
          religion: 'buddhism',
          coreTraits: ['honest', 'ambitious', 'patient'],
          childrenPlan: 'open',
          lifestyle: {
            smoking: 'not_important',
            drinking: 'occasionally',
            dailyRhythm: 'flexible',
            sports: 'sometimes',
          },
          financialIndependence: 'not_important',
          minEducation: 'master',
        },
      }),
      total: 61,
      pillars: [55, 60, 69],
      commonPoints: ['SHARED_TRAIT_HONEST', 'SAME_DRINKING'],
    },
    {
      name: 'xung đột gần như mọi mặt',
      a: candidate('a', { criteria: { religion: 'buddhism' } }),
      b: candidate('b', {
        birthDate: bornAged(40),
        cityKey: 'đà nẵng',
        criteria: {
          ageMin: 36,
          ageMax: 45,
          religion: 'catholicism',
          coreTraits: ['ambitious', 'humorous', 'patient'],
          childrenPlan: 'no_children',
          lifestyle: {
            smoking: 'regularly',
            drinking: 'regularly',
            dailyRhythm: 'night_owl',
            sports: 'rarely',
          },
          financialIndependence: 'required',
          minEducation: 'doctorate',
        },
      }),
      total: 12,
      pillars: [0, 6, 34],
      commonPoints: [],
    },
  ])('$name → tổng $total', ({ a = A, b, total, pillars, commonPoints }) => {
    const s = scorer.score(a, b, NOW);
    expect(s.total).toBe(total);
    expect([s.pillars.VALUES_FAMILY, s.pillars.PLANS_TIMING, s.pillars.LIFESTYLE_FINANCE]).toEqual(pillars);
    expect(s.commonPoints).toEqual(commonPoints);
  });

  it('cùng input → cùng điểm (gọi lại, scorer mới) và đối xứng score(a,b) = score(b,a)', () => {
    const b = candidate('b', {
      birthDate: bornAged(27),
      criteria: { religion: 'buddhism', coreTraits: ['kind', 'loyal', 'patient'], childrenPlan: 'open' },
    });
    const first = scorer.score(A, b, NOW);
    expect(scorer.score(A, b, NOW)).toEqual(first);
    expect(new CompatibilityScorer().score(A, b, NOW)).toEqual(first);
    expect(scorer.score(b, A, NOW)).toEqual(first);
  });

  it('mọi tổ hợp trong lưới mẫu: tổng và trụ cột là số nguyên trong [0, 100], đối xứng', () => {
    const profiles: CandidateProfile[] = [];
    let i = 0;
    for (const religion of RELIGIONS)
      for (const childrenPlan of CHILDREN_PLANS) {
        const k = i++;
        profiles.push(
          candidate(`p${k}`, {
            birthDate: bornAged(20 + (k % 40)),
            cityKey: k % 3 === 0 ? 'hà nội' : 'huế',
            education: EDUCATION_LEVELS[k % EDUCATION_LEVELS.length] ?? 'bachelor',
            criteria: {
              ageMin: 20 + (k % 10),
              ageMax: 30 + (k % 50),
              religion,
              childrenPlan,
              minEducation: k % 4 === 0 ? null : (EDUCATION_LEVELS[k % EDUCATION_LEVELS.length] ?? null),
              lifestyle: {
                smoking: SMOKING_HABITS[k % SMOKING_HABITS.length] ?? 'never',
                drinking: SMOKING_HABITS[(k + 1) % SMOKING_HABITS.length] ?? 'never',
                dailyRhythm: DAILY_RHYTHMS[k % DAILY_RHYTHMS.length] ?? 'flexible',
                sports: 'not_important',
              },
              coreTraits: [0, 1, 2].map((j) => CORE_TRAITS[(k + j * 5) % CORE_TRAITS.length] ?? 'honest'),
            },
          }),
        );
      }
    for (const a of profiles)
      for (const b of profiles) {
        const s = scorer.score(a, b, NOW);
        for (const v of [s.total, ...COMPATIBILITY_PILLARS.map((p) => s.pillars[p])]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
        expect(scorer.score(b, a, NOW)).toEqual(s);
      }
  });

  it('trọng số đọc từ cấu hình: chỉ tính trụ "Giá trị sống" → tổng = điểm trụ đó', () => {
    const custom = new CompatibilityScorer({
      ...DEFAULT_COMPATIBILITY_WEIGHTS,
      pillars: { VALUES_FAMILY: 1, PLANS_TIMING: 0, LIFESTYLE_FINANCE: 0 },
    });
    const s = custom.score(A, candidate('b'), NOW);
    expect(s.total).toBe(s.pillars.VALUES_FAMILY);
    expect(s.total).toBe(85);
  });

  it('làm tròn nửa lên khi trung bình ra .5 (12.5 → 13 ở lối sống)', () => {
    const b = candidate('b', {
      criteria: {
        lifestyle: {
          smoking: 'regularly',
          drinking: 'regularly',
          dailyRhythm: 'night_owl',
          sports: 'rarely',
        },
      },
    });
    // Lối sống (0 + 50 + 0 + 0) / 4 = 12.5 → 13; tài chính 100; học vấn 100 → (50·13 + 25·100 + 25·100) / 100 = 56.5 → 57.
    expect(scorer.score(A, b, NOW).pillars.LIFESTYLE_FINANCE).toBe(57);
  });
});
