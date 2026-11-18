import { fail, ok, type DomainError, type Result } from '@tamgiao/kernel';

/** 9 chữ số sau mã quốc gia; đầu số di động Việt Nam hiện hành bắt đầu bằng 3, 5, 7, 8, 9. */
const VN_MOBILE_NATIONAL = /^[35789]\d{8}$/;

/** Số di động Việt Nam đã chuẩn hoá về E.164 (`+84xxxxxxxxx`). */
export class PhoneNumber {
  private constructor(readonly e164: string) {}

  /** Nhận `0912 345 678`, `84912345678`, `+84 912.345.678`, `+840912345678`… */
  static parse(raw: string): Result<PhoneNumber, DomainError<'PHONE_INVALID'>> {
    const compact = raw.replace(/[\s.\-()]/g, '');
    let national: string;
    if (compact.startsWith('+84')) national = compact.slice(3).replace(/^0/, '');
    else if (compact.startsWith('84') && compact.length === 11) national = compact.slice(2);
    else if (compact.startsWith('0')) national = compact.slice(1);
    else return fail('PHONE_INVALID');

    if (!VN_MOBILE_NATIONAL.test(national)) return fail('PHONE_INVALID');
    return ok(new PhoneNumber(`+84${national}`));
  }

  equals(other: PhoneNumber): boolean {
    return this.e164 === other.e164;
  }

  /** Dạng che để hiển thị/ghi chú, vd `+84•••••5678`. */
  masked(): string {
    return `+84•••••${this.e164.slice(-4)}`;
  }
}
