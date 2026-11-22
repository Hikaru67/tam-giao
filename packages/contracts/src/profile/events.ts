/** Hồ sơ cơ bản lần đầu được hoàn tất (người dùng bấm "Tiếp tục" với đủ trường bắt buộc). Không chứa PII. */
export const PROFILE_COMPLETED = 'ProfileCompleted';
export interface ProfileCompletedPayload {
  readonly userId: string;
}

/** Tiêu chí bạn đời được tạo/cập nhật — matching (BE-S5-03) tính lại ứng viên. Không chứa PII. */
export const PREFERENCES_UPDATED = 'PreferencesUpdated';
export interface PreferencesUpdatedPayload {
  readonly userId: string;
}

/**
 * Hồ sơ **đã hoàn tất** được lưu lại (BE-S6-07) — matching đồng bộ lại read model ứng viên (vd hồ sơ cũ bổ sung tôn
 * giáo / kế hoạch con cái). Lần hoàn tất đầu tiên chỉ phát `ProfileCompleted`. Không chứa PII.
 */
export const PROFILE_UPDATED = 'ProfileUpdated';
export interface ProfileUpdatedPayload {
  readonly userId: string;
}
