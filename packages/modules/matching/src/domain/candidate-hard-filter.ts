import { ageAt, NOT_IMPORTANT, type CandidateProfile, type PartnerCriteria } from './candidate-profile.js';

/**
 * Bộ lọc cứng (BE-S5-03, BE-S6-07) — định nghĩa chuẩn; `DrizzleCandidateFinder` viết lại đúng luật này bằng SQL (test
 * tích hợp đối chiếu). Một cặp chỉ hợp lệ khi **cả hai chiều** "người kia thoả tiêu chí của mình" đều qua:
 * - Tuổi: tuổi của người kia nằm trong `[ageMin, ageMax]` của mình.
 * - Khu vực: `cityKey` tiêu chí `null` = không giới hạn; ngược lại nơi sống của người kia phải trùng. Bán kính
 *   (`areaRadiusKm`) chưa áp dụng — chưa có toạ độ.
 * - Tôn giáo / kế hoạch con cái: so **hồ sơ của người kia** với tiêu chí của mình (xem `religionAccepts`,
 *   `childrenPlanAccepts`).
 * - Giới tính: chỉ ghép khác giới (quyết định của PO khi review BE-S5-03).
 */
export function passesHardFilters(a: CandidateProfile, b: CandidateProfile, now: Date): boolean {
  return gendersCompatible(a, b) && acceptsPerson(a.criteria, b, now) && acceptsPerson(b.criteria, a, now);
}

/** Chiều "người `person` thoả tiêu chí `criteria`" (tuổi, khu vực, tôn giáo, kế hoạch con cái). */
export function acceptsPerson(criteria: PartnerCriteria, person: CandidateProfile, now: Date): boolean {
  const age = ageAt(person.birthDate, now);
  if (age < criteria.ageMin || age > criteria.ageMax) return false;
  if (criteria.cityKey !== null && criteria.cityKey !== person.cityKey) return false;
  return religionAccepts(criteria, person) && childrenPlanAccepts(criteria, person);
}

/** Chỉ ghép khác giới. */
export function gendersCompatible(a: CandidateProfile, b: CandidateProfile): boolean {
  return a.gender !== b.gender;
}

/**
 * Tôn giáo của `person` thoả tiêu chí: tiêu chí `not_important` → bỏ qua; hồ sơ chưa khai (`null`, hồ sơ cũ trước
 * BE-S6-07) → **không loại** (để danh sách không rỗng khi người dùng chưa cập nhật); còn lại phải trùng.
 */
export function religionAccepts(criteria: PartnerCriteria, person: CandidateProfile): boolean {
  return (
    criteria.religion === NOT_IMPORTANT || person.religion === null || criteria.religion === person.religion
  );
}

/**
 * Kế hoạch con cái của `person` thoả tiêu chí: tiêu chí `not_important` hoặc `open` (để ngỏ) → nhận mọi hồ sơ; hồ sơ
 * `open` (chưa quyết định) → hợp mọi tiêu chí; hồ sơ chưa khai (`null`) → không loại; còn lại phải trùng.
 */
export function childrenPlanAccepts(criteria: PartnerCriteria, person: CandidateProfile): boolean {
  const c = criteria.childrenPlan;
  const p = person.childrenPlan;
  return c === NOT_IMPORTANT || c === 'open' || p === null || p === 'open' || c === p;
}
