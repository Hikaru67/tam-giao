/**
 * Hồ sơ ứng viên dạng Value Object cho lọc cứng + chấm điểm tương hợp (BE-S5-03). Danh mục giá trị trùng với
 * module profile / `@tamgiao/contracts` (domain không import module khác — A3); application gán trực tiếp dữ liệu
 * từ facade profile vào đây nên lệch danh mục sẽ lỗi typecheck.
 */

export const NOT_IMPORTANT = 'not_important';

export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];
/** Tăng dần theo cấp học. */
export const EDUCATION_LEVELS = ['high_school', 'college', 'bachelor', 'master', 'doctorate'] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];
export const CHILDREN_PLANS = ['want_children', 'no_children', 'open', NOT_IMPORTANT] as const;
export type ChildrenPlan = (typeof CHILDREN_PLANS)[number];
export const RELIGIONS = [
  'none',
  'buddhism',
  'catholicism',
  'protestantism',
  'caodaism',
  'hoa_hao',
  'other',
  NOT_IMPORTANT,
] as const;
export type Religion = (typeof RELIGIONS)[number];
export const SMOKING_HABITS = ['never', 'occasionally', 'regularly', NOT_IMPORTANT] as const;
export const DRINKING_HABITS = ['never', 'occasionally', 'regularly', NOT_IMPORTANT] as const;
export const DAILY_RHYTHMS = ['early_bird', 'night_owl', 'flexible', NOT_IMPORTANT] as const;
export const SPORTS_HABITS = ['regularly', 'sometimes', 'rarely', NOT_IMPORTANT] as const;
export const FINANCIAL_INDEPENDENCE = ['required', 'preferred', NOT_IMPORTANT] as const;
export type FinancialIndependence = (typeof FINANCIAL_INDEPENDENCE)[number];
export const CORE_TRAITS = [
  'honest',
  'kind',
  'responsible',
  'ambitious',
  'family_oriented',
  'humorous',
  'patient',
  'independent',
  'loyal',
  'respectful',
  'generous',
  'optimistic',
] as const;
export type CoreTrait = (typeof CORE_TRAITS)[number];

export interface Lifestyle {
  readonly smoking: (typeof SMOKING_HABITS)[number];
  readonly drinking: (typeof DRINKING_HABITS)[number];
  readonly dailyRhythm: (typeof DAILY_RHYTHMS)[number];
  readonly sports: (typeof SPORTS_HABITS)[number];
}

/**
 * Tiêu chí bạn đời của một người. Hồ sơ không có trường tôn giáo / kế hoạch con cái riêng, nên `religion`,
 * `childrenPlan` (và lối sống, độc lập tài chính) vừa là tiêu chí vừa là quan điểm của chính người đó — luật lọc
 * và chấm điểm so khớp **đối xứng** hai giá trị này.
 */
export interface PartnerCriteria {
  readonly ageMin: number;
  readonly ageMax: number;
  /** Khoá thành phố đã chuẩn hoá (`cityKey`); `null` = không giới hạn khu vực. */
  readonly cityKey: string | null;
  readonly childrenPlan: ChildrenPlan;
  readonly religion: Religion;
  readonly minEducation: EducationLevel | null;
  readonly lifestyle: Lifestyle;
  readonly financialIndependence: FinancialIndependence;
  readonly coreTraits: readonly CoreTrait[];
}

export interface CandidateProfile {
  readonly userId: string;
  readonly gender: Gender;
  /** `YYYY-MM-DD`. */
  readonly birthDate: string;
  /** Khoá thành phố nơi sống đã chuẩn hoá (`cityKey`). */
  readonly cityKey: string;
  readonly education: EducationLevel;
  readonly criteria: PartnerCriteria;
}

/**
 * Chuẩn hoá tên tỉnh/thành người dùng nhập tự do để so khớp: Unicode NFC, bỏ khoảng trắng thừa, chữ thường.
 * (Không gộp biến thể "TP.HCM" / "Hồ Chí Minh" — cần danh mục tỉnh/thành, ngoài phạm vi.)
 */
export function cityKey(city: string): string {
  return city.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Múi giờ Việt Nam (UTC+7) — tuổi tính theo ngày lịch tại Việt Nam, như module profile. */
const VN_OFFSET_MS = 7 * 3_600_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Ngày lịch Việt Nam tại `now`, dạng `YYYY-MM-DD` (dùng làm tham số SQL tính tuổi). */
export function vnDate(now: Date): string {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Tuổi tròn tại `now` (theo ngày lịch Việt Nam); ngày sinh sai định dạng là lỗi lập trình. */
export function ageAt(birthDate: string, now: Date): number {
  const m = DATE_PATTERN.exec(birthDate);
  const t = DATE_PATTERN.exec(vnDate(now));
  if (!m || !t) throw new Error('ageAt: ngày sinh không hợp lệ');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [ty, tm, td] = [Number(t[1]), Number(t[2]), Number(t[3])];
  let age = ty - y;
  if (tm < mo || (tm === mo && td < d)) age -= 1;
  return age;
}
