/**
 * Cấu hình chấm điểm tương hợp (BE-S5-03) — nơi DUY NHẤT chứa trọng số và thang điểm. Mọi giá trị là số nguyên
 * (điểm 0–100, trọng số tương đối) để phép tính không có float tích luỹ. Đổi số ở đây = đổi cách xếp hạng ứng viên;
 * cập nhật test bảng `compatibility-scorer.test.ts` cùng lúc.
 */

export const COMPATIBILITY_PILLARS = ['VALUES_FAMILY', 'PLANS_TIMING', 'LIFESTYLE_FINANCE'] as const;
/**
 * - `VALUES_FAMILY`: "Giá trị sống & Gia đình" (tôn giáo, phẩm chất cốt lõi).
 * - `PLANS_TIMING`: "Kế hoạch & Thời điểm kết hôn" (kế hoạch con cái, độ tuổi mong muốn, nơi sống).
 * - `LIFESTYLE_FINANCE`: "Lối sống & Tài chính" (thói quen, quan điểm độc lập tài chính, học vấn tối thiểu).
 */
export type CompatibilityPillar = (typeof COMPATIBILITY_PILLARS)[number];

export interface CompatibilityWeights {
  /** Trọng số của từng trụ cột khi tính tổng. */
  readonly pillars: Readonly<Record<CompatibilityPillar, number>>;
  readonly valuesFamily: { readonly religion: number; readonly coreTraits: number };
  readonly plansTiming: { readonly childrenPlan: number; readonly ageFit: number; readonly location: number };
  readonly lifestyleFinance: {
    readonly lifestyle: number;
    readonly financialIndependence: number;
    readonly education: number;
  };
  readonly scores: CompatibilityScoreScale;
}

/** Điểm (0–100) cho từng mức khớp của một yếu tố. */
export interface CompatibilityScoreScale {
  /** Cùng giá trị cụ thể. */
  readonly same: number;
  /** Ít nhất một bên chọn "không quan trọng" — không xung đột nhưng cũng không chắc khớp. */
  readonly notImportant: number;
  /** Kế hoạch con cái: một bên "để ngỏ" (`open`), bên kia có kế hoạch cụ thể. */
  readonly childrenOpen: number;
  /** Lối sống: hai mức kề nhau (vd `never` – `occasionally`). */
  readonly lifestyleAdjacent: number;
  /** Độc lập tài chính: `required` – `preferred`. */
  readonly financialCloseView: number;
  /** Khác thành phố (bộ lọc khu vực của cả hai cho phép). */
  readonly differentCity: number;
  /** Học vấn thấp hơn mức tối thiểu đúng một bậc. */
  readonly educationOneBelow: number;
  /** Điểm theo số phẩm chất cốt lõi trùng nhau (chỉ số = số phẩm chất trùng, 0…3). */
  readonly sharedCoreTraits: readonly [number, number, number, number];
  /** Độ lệch khỏi tâm khoảng tuổi mong muốn: ở mép khoảng tuổi bị trừ chừng này điểm (ở tâm = 100). */
  readonly ageEdgePenalty: number;
}

export const DEFAULT_COMPATIBILITY_WEIGHTS: CompatibilityWeights = {
  pillars: { VALUES_FAMILY: 40, PLANS_TIMING: 30, LIFESTYLE_FINANCE: 30 },
  valuesFamily: { religion: 50, coreTraits: 50 },
  plansTiming: { childrenPlan: 50, ageFit: 30, location: 20 },
  lifestyleFinance: { lifestyle: 50, financialIndependence: 25, education: 25 },
  scores: {
    same: 100,
    notImportant: 70,
    childrenOpen: 60,
    lifestyleAdjacent: 50,
    financialCloseView: 60,
    differentCity: 30,
    educationOneBelow: 40,
    sharedCoreTraits: [0, 40, 75, 100],
    ageEdgePenalty: 50,
  },
};
