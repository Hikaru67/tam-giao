/**
 * Registry mã lỗi dùng chung BE ↔ FE (AGENTS.md A4).
 * Mỗi module đăng ký mã lỗi của mình bằng `registerErrors(owner, { CODE: { status, title } })`
 * trong file `packages/contracts/src/<module>/errors.ts`. Đăng ký trùng mã → throw ngay khi nạp module,
 * nên lỗi lộ ra ở test/khởi động, không lọt tới production.
 */

export type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 500 | 502 | 503;

export interface ErrorDefinition {
  /** HTTP status mặc định khi trả lỗi này ra API. */
  readonly status: HttpErrorStatus;
  /** Mô tả ngắn tiếng Việt cho dev/FE (không hiển thị nguyên văn cho người dùng). */
  readonly title: string;
}

export interface RegisteredError extends ErrorDefinition {
  readonly code: string;
  readonly owner: string;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

export class ErrorRegistry {
  private readonly entries = new Map<string, RegisteredError>();

  register<const C extends string>(owner: string, defs: Readonly<Record<C, ErrorDefinition>>): readonly C[] {
    const codes = Object.keys(defs) as C[];
    for (const code of codes) {
      if (!CODE_PATTERN.test(code)) {
        throw new Error(`[contracts] Mã lỗi "${code}" (${owner}) phải là UPPER_SNAKE_CASE`);
      }
      const existing = this.entries.get(code);
      if (existing) {
        throw new Error(
          `[contracts] Mã lỗi "${code}" đã được "${existing.owner}" đăng ký, "${owner}" không được đăng ký lại`,
        );
      }
    }
    for (const code of codes) {
      this.entries.set(code, { code, owner, ...defs[code] });
    }
    return codes;
  }

  get(code: string): RegisteredError | undefined {
    return this.entries.get(code);
  }

  /** Mã chưa đăng ký → 500 (lỗi lập trình: quên đăng ký). */
  statusOf(code: string): HttpErrorStatus {
    return this.entries.get(code)?.status ?? 500;
  }

  list(): readonly RegisteredError[] {
    return [...this.entries.values()];
  }
}

/** Registry toàn cục của ứng dụng. */
export const errorRegistry = new ErrorRegistry();

export const registerErrors = <const C extends string>(
  owner: string,
  defs: Readonly<Record<C, ErrorDefinition>>,
): readonly C[] => errorRegistry.register(owner, defs);

/** Mã lỗi chung, không thuộc module nghiệp vụ nào (kể cả lỗi của kernel). */
export const COMMON_ERROR_CODES = registerErrors('common', {
  VALIDATION_FAILED: { status: 422, title: 'Dữ liệu đầu vào không hợp lệ' },
  UNAUTHENTICATED: { status: 401, title: 'Chưa đăng nhập hoặc phiên đã hết hạn' },
  FORBIDDEN: { status: 403, title: 'Không có quyền thực hiện' },
  NOT_FOUND: { status: 404, title: 'Không tìm thấy tài nguyên' },
  RATE_LIMITED: { status: 429, title: 'Thao tác quá nhanh, vui lòng thử lại sau' },
  PAYLOAD_TOO_LARGE: { status: 413, title: 'Dữ liệu gửi lên quá lớn' },
  INTERNAL_ERROR: { status: 500, title: 'Lỗi hệ thống' },
  INVALID_ID: { status: 400, title: 'Định danh không hợp lệ' },
  MONEY_INVALID: { status: 422, title: 'Số tiền không hợp lệ' },
  MONEY_NEGATIVE: { status: 422, title: 'Số tiền không được âm' },
});
