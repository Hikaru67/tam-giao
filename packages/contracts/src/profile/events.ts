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
