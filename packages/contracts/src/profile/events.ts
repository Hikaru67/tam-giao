/** Hồ sơ cơ bản lần đầu được hoàn tất (người dùng bấm "Tiếp tục" với đủ trường bắt buộc). Không chứa PII. */
export const PROFILE_COMPLETED = 'ProfileCompleted';
export interface ProfileCompletedPayload {
  readonly userId: string;
}
