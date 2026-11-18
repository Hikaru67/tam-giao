import { z } from 'zod';
import { MIN_AGE } from '../constants.js';
import { EDUCATION_LEVELS } from './dto.js';

/** Tuổi tối đa chọn được ở bộ lọc (BE-S2-06 AC2). */
export const PREFERENCE_AGE_MAX = 80;
export const PREFERENCE_RADIUS_KM_MAX = 500;
export const CORE_TRAITS_COUNT = 3;

/** Giá trị "Không quan trọng" — bỏ qua tiêu chí khi chấm điểm/lọc. */
export const NOT_IMPORTANT = 'not_important';

export const CHILDREN_PLANS = ['want_children', 'no_children', 'open', NOT_IMPORTANT] as const;
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
export const SMOKING_HABITS = ['never', 'occasionally', 'regularly', NOT_IMPORTANT] as const;
export const DRINKING_HABITS = ['never', 'occasionally', 'regularly', NOT_IMPORTANT] as const;
export const DAILY_RHYTHMS = ['early_bird', 'night_owl', 'flexible', NOT_IMPORTANT] as const;
export const SPORTS_HABITS = ['regularly', 'sometimes', 'rarely', NOT_IMPORTANT] as const;
export const FINANCIAL_INDEPENDENCE = ['required', 'preferred', NOT_IMPORTANT] as const;
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

const age = z.number().int().min(MIN_AGE).max(PREFERENCE_AGE_MAX);

/**
 * `PUT /me/preferences` — gửi toàn bộ tiêu chí. Khoảng tuổi phải nằm trong [`MIN_AGE`, 80] và `ageMin ≤ ageMax`
 * (`VALIDATION_FAILED`); `coreTraits` phải đúng 3 giá trị khác nhau (`INVALID_CORE_TRAITS`, kiểm tra ở server).
 */
const preferencesShape = z.object({
  ageMin: age,
  ageMax: age,
  area: z.object({
    /** Tỉnh/thành mong muốn; `null` = không giới hạn khu vực. */
    city: z.string().trim().min(1).max(100).nullable(),
    /** Bán kính quanh nơi sống của người dùng; `null` = cả tỉnh/thành. */
    radiusKm: z.number().int().min(1).max(PREFERENCE_RADIUS_KM_MAX).nullable(),
  }),
  childrenPlan: z.enum(CHILDREN_PLANS),
  religion: z.enum(RELIGIONS),
  lifestyle: z.object({
    smoking: z.enum(SMOKING_HABITS),
    drinking: z.enum(DRINKING_HABITS),
    dailyRhythm: z.enum(DAILY_RHYTHMS),
    sports: z.enum(SPORTS_HABITS),
  }),
  /** `null` = không yêu cầu. */
  minEducation: z.enum(EDUCATION_LEVELS).nullable(),
  financialIndependence: z.enum(FINANCIAL_INDEPENDENCE),
  /** Giới hạn độ dài lỏng để server trả `INVALID_CORE_TRAITS` thay vì lỗi validate chung. */
  coreTraits: z.array(z.enum(CORE_TRAITS)).max(10),
});

export const updatePreferencesBodySchema = preferencesShape.refine((p) => p.ageMin <= p.ageMax, {
  message: '`ageMin` phải ≤ `ageMax`',
  path: ['ageMax'],
});
export type UpdatePreferencesBody = z.infer<typeof updatePreferencesBodySchema>;

export const preferencesResponseSchema = preferencesShape.extend({
  userId: z.uuid(),
  updatedAt: z.iso.datetime(),
});
export type PreferencesResponse = z.infer<typeof preferencesResponseSchema>;
