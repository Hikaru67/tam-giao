import { err, type Result } from './result.js';

/**
 * Lỗi nghiệp vụ. `code` là chuỗi UPPER_SNAKE_CASE, khai báo trong `domain/errors.ts` của module
 * và đăng ký ở `@tamgiao/contracts` (AGENTS.md A4). `details` chỉ chứa dữ liệu không nhạy cảm.
 */
export interface DomainError<C extends string = string> {
  readonly code: C;
  readonly details?: Readonly<Record<string, unknown>>;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

export function domainError<C extends string>(
  code: C,
  details?: Readonly<Record<string, unknown>>,
): DomainError<C> {
  if (!CODE_PATTERN.test(code)) {
    throw new Error(`Mã lỗi "${code}" phải là UPPER_SNAKE_CASE`);
  }
  return details === undefined ? { code } : { code, details };
}

/** Viết tắt của `err(domainError(code, details))`. */
export function fail<C extends string, T = never>(
  code: C,
  details?: Readonly<Record<string, unknown>>,
): Result<T, DomainError<C>> {
  return err(domainError(code, details));
}
