import { ageAt, NOT_IMPORTANT, type CandidateProfile, type PartnerCriteria } from './candidate-profile.js';

/**
 * Bộ lọc cứng (BE-S5-03) — định nghĩa chuẩn; `DrizzleCandidateFinder` viết lại đúng luật này bằng SQL (test tích hợp
 * đối chiếu). Một cặp chỉ hợp lệ khi **cả hai chiều** đều qua:
 * - Tuổi: tuổi của người kia nằm trong `[ageMin, ageMax]` của mình.
 * - Khu vực: `cityKey` tiêu chí `null` = không giới hạn; ngược lại nơi sống của người kia phải trùng. Bán kính
 *   (`areaRadiusKm`) chưa áp dụng — chưa có toạ độ.
 * - Tôn giáo / kế hoạch con cái: so khớp đối xứng hai quan điểm (hồ sơ không có trường riêng): "không quan trọng"
 *   ở một bên = bỏ qua; con cái "để ngỏ" (`open`) hợp với mọi lựa chọn; còn lại phải trùng.
 * - Giới tính: CHƯA lọc — sản phẩm chưa có luật "giới tính phù hợp" (xem báo cáo BE-S5-03, Blocker).
 */
export function passesHardFilters(a: CandidateProfile, b: CandidateProfile, now: Date): boolean {
  return (
    acceptsPerson(a.criteria, b, now) &&
    acceptsPerson(b.criteria, a, now) &&
    religionCompatible(a.criteria, b.criteria) &&
    childrenPlanCompatible(a.criteria, b.criteria)
  );
}

/** Chiều "người `person` thoả tiêu chí `criteria`" (tuổi + khu vực). */
export function acceptsPerson(criteria: PartnerCriteria, person: CandidateProfile, now: Date): boolean {
  const age = ageAt(person.birthDate, now);
  if (age < criteria.ageMin || age > criteria.ageMax) return false;
  return criteria.cityKey === null || criteria.cityKey === person.cityKey;
}

export function religionCompatible(x: PartnerCriteria, y: PartnerCriteria): boolean {
  return x.religion === NOT_IMPORTANT || y.religion === NOT_IMPORTANT || x.religion === y.religion;
}

export function childrenPlanCompatible(x: PartnerCriteria, y: PartnerCriteria): boolean {
  const flexible = (v: string) => v === NOT_IMPORTANT || v === 'open';
  return flexible(x.childrenPlan) || flexible(y.childrenPlan) || x.childrenPlan === y.childrenPlan;
}
