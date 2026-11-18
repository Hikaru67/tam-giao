import { fail, ok, type DomainError, type Result } from '@tamgiao/kernel';

const CCCD_PATTERN = /^\d{12}$/;
/** 3 số đầu là mã tỉnh/thành nơi đăng ký khai sinh, nằm trong khoảng 001–096. */
const MIN_PROVINCE_CODE = 1;
const MAX_PROVINCE_CODE = 96;

/**
 * Số Căn cước công dân (12 chữ số). Là dữ liệu nhạy cảm: repository mã hoá qua `Encryptor` + blind index,
 * không bao giờ đưa vào event/log. `toString()`/`toJSON()` trả dạng che để lỡ ghi log cũng không lộ số.
 */
export class CccdNumber {
  private constructor(readonly value: string) {}

  /** Nhận chuỗi 12 chữ số, cho phép khoảng trắng / dấu chấm / gạch ngang phân tách (vd `001 090 012 345`). */
  static parse(raw: string): Result<CccdNumber, DomainError<'INVALID_CCCD_NUMBER'>> {
    const compact = raw.replace(/[\s.-]/g, '');
    if (!CCCD_PATTERN.test(compact)) return fail('INVALID_CCCD_NUMBER');
    const province = Number(compact.slice(0, 3));
    if (province < MIN_PROVINCE_CODE || province > MAX_PROVINCE_CODE) return fail('INVALID_CCCD_NUMBER');
    return ok(new CccdNumber(compact));
  }

  equals(other: CccdNumber): boolean {
    return this.value === other.value;
  }

  /** Dạng che để hiển thị, vd `********2345`. */
  masked(): string {
    return `${'*'.repeat(8)}${this.value.slice(-4)}`;
  }

  toString(): string {
    return this.masked();
  }

  toJSON(): string {
    return this.masked();
  }
}
