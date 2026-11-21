import {
  ageAt,
  CORE_TRAITS,
  EDUCATION_LEVELS,
  NOT_IMPORTANT,
  type CandidateProfile,
  type CoreTrait,
  type Lifestyle,
} from './candidate-profile.js';
import {
  DEFAULT_COMPATIBILITY_WEIGHTS,
  type CompatibilityPillar,
  type CompatibilityWeights,
} from './compatibility-weights.js';

/** Mã điểm chung (không chứa giá trị cụ thể / PII) — FE tự dịch thành câu hiển thị. */
export type CommonPointCode =
  | 'SAME_RELIGION'
  | 'SAME_CHILDREN_PLAN'
  | 'SAME_CITY'
  | `SHARED_TRAIT_${Uppercase<CoreTrait>}`
  | 'SAME_SMOKING'
  | 'SAME_DRINKING'
  | 'SAME_DAILY_RHYTHM'
  | 'SAME_SPORTS'
  | 'SAME_FINANCIAL_VIEW';

export interface CompatibilityScore {
  /** Tổng 0–100 (số nguyên) — trung bình có trọng số của 3 trụ cột. */
  readonly total: number;
  /** Điểm từng trụ cột 0–100 (số nguyên). */
  readonly pillars: Readonly<Record<CompatibilityPillar, number>>;
  /** Thứ tự cố định (không phụ thuộc thứ tự hai người). */
  readonly commonPoints: readonly CommonPointCode[];
}

/** Trung bình có trọng số, làm tròn nửa lên — toàn số nguyên nên kết quả không phụ thuộc thứ tự cộng. */
function weightedRound(parts: readonly (readonly [weight: number, score: number])[]): number {
  let num = 0;
  let den = 0;
  for (const [w, s] of parts) {
    num += w * s;
    den += w;
  }
  if (den === 0) return 0;
  return Math.floor((2 * num + den) / (2 * den));
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/** Thứ bậc của từng mục lối sống — hai mức cách nhau 1 = kề nhau, 2 = trái ngược. */
const LIFESTYLE_ORDER: { readonly [K in keyof Lifestyle]: readonly string[] } = {
  smoking: ['never', 'occasionally', 'regularly'],
  drinking: ['never', 'occasionally', 'regularly'],
  dailyRhythm: ['early_bird', 'flexible', 'night_owl'],
  sports: ['regularly', 'sometimes', 'rarely'],
};
const LIFESTYLE_KEYS = ['smoking', 'drinking', 'dailyRhythm', 'sports'] as const;
const LIFESTYLE_COMMON: Readonly<Record<keyof Lifestyle, CommonPointCode>> = {
  smoking: 'SAME_SMOKING',
  drinking: 'SAME_DRINKING',
  dailyRhythm: 'SAME_DAILY_RHYTHM',
  sports: 'SAME_SPORTS',
};

/**
 * Domain service chấm điểm tương hợp (BE-S5-03): thuần, deterministic, đối xứng (`score(a, b) = score(b, a)`).
 * Không kiểm tra bộ lọc cứng (xem `passesHardFilters`) — yếu tố vi phạm chỉ nhận điểm thấp.
 * `now` chỉ dùng tính tuổi (theo ngày lịch Việt Nam).
 */
export class CompatibilityScorer {
  constructor(private readonly weights: CompatibilityWeights = DEFAULT_COMPATIBILITY_WEIGHTS) {}

  score(a: CandidateProfile, b: CandidateProfile, now: Date): CompatibilityScore {
    const w = this.weights;
    const valuesFamily = weightedRound([
      [w.valuesFamily.religion, this.stance(a.criteria.religion, b.criteria.religion)],
      [w.valuesFamily.coreTraits, this.coreTraits(a, b)],
    ]);
    const plansTiming = weightedRound([
      [w.plansTiming.childrenPlan, this.childrenPlan(a, b)],
      [
        w.plansTiming.ageFit,
        weightedRound([
          [1, this.ageFit(a, b, now)],
          [1, this.ageFit(b, a, now)],
        ]),
      ],
      [w.plansTiming.location, a.cityKey === b.cityKey ? w.scores.same : w.scores.differentCity],
    ]);
    const lifestyleFinance = weightedRound([
      [w.lifestyleFinance.lifestyle, this.lifestyle(a.criteria.lifestyle, b.criteria.lifestyle)],
      [w.lifestyleFinance.financialIndependence, this.financial(a, b)],
      [
        w.lifestyleFinance.education,
        weightedRound([
          [1, this.education(a, b)],
          [1, this.education(b, a)],
        ]),
      ],
    ]);
    const pillars = {
      VALUES_FAMILY: clamp(valuesFamily),
      PLANS_TIMING: clamp(plansTiming),
      LIFESTYLE_FINANCE: clamp(lifestyleFinance),
    };
    const total = clamp(
      weightedRound([
        [w.pillars.VALUES_FAMILY, pillars.VALUES_FAMILY],
        [w.pillars.PLANS_TIMING, pillars.PLANS_TIMING],
        [w.pillars.LIFESTYLE_FINANCE, pillars.LIFESTYLE_FINANCE],
      ]),
    );
    return { total, pillars, commonPoints: commonPoints(a, b) };
  }

  /** Hai quan điểm định danh (tôn giáo): trùng → `same`; có "không quan trọng" → `notImportant`; khác → 0. */
  private stance(x: string, y: string): number {
    if (x === NOT_IMPORTANT || y === NOT_IMPORTANT) return this.weights.scores.notImportant;
    return x === y ? this.weights.scores.same : 0;
  }

  private childrenPlan(a: CandidateProfile, b: CandidateProfile): number {
    const [x, y] = [a.criteria.childrenPlan, b.criteria.childrenPlan];
    const s = this.weights.scores;
    if (x === NOT_IMPORTANT || y === NOT_IMPORTANT) return s.notImportant;
    if (x === y) return s.same;
    if (x === 'open' || y === 'open') return s.childrenOpen;
    return 0;
  }

  private coreTraits(a: CandidateProfile, b: CandidateProfile): number {
    const shared = a.criteria.coreTraits.filter((t) => b.criteria.coreTraits.includes(t)).length;
    const table = this.weights.scores.sharedCoreTraits;
    return table[Math.min(shared, table.length - 1)] ?? 0;
  }

  /**
   * `person` nằm ở đâu trong khoảng tuổi `seeker` mong muốn: ở tâm = 100, ở mép = 100 − `ageEdgePenalty`,
   * ngoài khoảng = 0. Tính bằng số nguyên: |2·tuổi − (min + max)| / (max − min) là độ lệch tương đối 0…1.
   */
  private ageFit(seeker: CandidateProfile, person: CandidateProfile, now: Date): number {
    const { ageMin, ageMax } = seeker.criteria;
    const age = ageAt(person.birthDate, now);
    if (age < ageMin || age > ageMax) return 0;
    const spread = Math.max(1, ageMax - ageMin);
    const offset = Math.abs(2 * age - (ageMin + ageMax));
    return clamp(100 - Math.floor((this.weights.scores.ageEdgePenalty * offset) / spread));
  }

  private lifestyle(x: Lifestyle, y: Lifestyle): number {
    const s = this.weights.scores;
    return weightedRound(
      LIFESTYLE_KEYS.map((key) => {
        const [vx, vy] = [x[key], y[key]];
        if (vx === NOT_IMPORTANT || vy === NOT_IMPORTANT) return [1, s.notImportant] as const;
        const order = LIFESTYLE_ORDER[key];
        const distance = Math.abs(order.indexOf(vx) - order.indexOf(vy));
        return [1, distance === 0 ? s.same : distance === 1 ? s.lifestyleAdjacent : 0] as const;
      }),
    );
  }

  private financial(a: CandidateProfile, b: CandidateProfile): number {
    const [x, y] = [a.criteria.financialIndependence, b.criteria.financialIndependence];
    const s = this.weights.scores;
    if (x === NOT_IMPORTANT || y === NOT_IMPORTANT) return s.notImportant;
    return x === y ? s.same : s.financialCloseView;
  }

  /** `person` đạt học vấn tối thiểu `seeker` mong muốn? Không yêu cầu / đạt → `same`; thiếu 1 bậc → giảm; thiếu từ 2 bậc → 0. */
  private education(seeker: CandidateProfile, person: CandidateProfile): number {
    const min = seeker.criteria.minEducation;
    const s = this.weights.scores;
    if (min === null) return s.same;
    const gap = EDUCATION_LEVELS.indexOf(min) - EDUCATION_LEVELS.indexOf(person.education);
    if (gap <= 0) return s.same;
    return gap === 1 ? s.educationOneBelow : 0;
  }
}

function commonPoints(a: CandidateProfile, b: CandidateProfile): CommonPointCode[] {
  const out: CommonPointCode[] = [];
  const concreteSame = (x: string, y: string) => x !== NOT_IMPORTANT && x === y;
  if (concreteSame(a.criteria.religion, b.criteria.religion)) out.push('SAME_RELIGION');
  if (concreteSame(a.criteria.childrenPlan, b.criteria.childrenPlan)) out.push('SAME_CHILDREN_PLAN');
  if (a.cityKey === b.cityKey) out.push('SAME_CITY');
  for (const trait of CORE_TRAITS) {
    if (a.criteria.coreTraits.includes(trait) && b.criteria.coreTraits.includes(trait)) {
      out.push(`SHARED_TRAIT_${trait.toUpperCase() as Uppercase<CoreTrait>}`);
    }
  }
  for (const key of LIFESTYLE_KEYS) {
    if (concreteSame(a.criteria.lifestyle[key], b.criteria.lifestyle[key])) out.push(LIFESTYLE_COMMON[key]);
  }
  if (concreteSame(a.criteria.financialIndependence, b.criteria.financialIndependence)) {
    out.push('SAME_FINANCIAL_VIEW');
  }
  return out;
}
