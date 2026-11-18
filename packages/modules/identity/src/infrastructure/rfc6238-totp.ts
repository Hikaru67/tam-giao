import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TotpService } from '../application/ports/totp.js';

/** Bảng ký tự Base32 theo chuẩn RFC 4648 (A-Z và 2-7). */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Chu kỳ thời gian của mã TOTP tính bằng giây theo RFC 6238. */
const PERIOD_SECONDS = 30;

/** Độ dài mã TOTP chuẩn (6 chữ số). */
const DIGITS = 6;

/** Hệ số chia lấy dư cho 6 chữ số: 10^6. */
const DIGITS_MODULO = 10 ** DIGITS;

/**
 * Mã hoá Buffer thành chuỗi Base32 theo RFC 4648 không padding.
 */
function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer.readUInt8(i);
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      const index = (value >>> (bits - 5)) & 31;
      output += BASE32_ALPHABET.charAt(index);
      bits -= 5;
    }
  }

  if (bits > 0) {
    const index = (value << (5 - bits)) & 31;
    output += BASE32_ALPHABET.charAt(index);
  }

  return output;
}

/**
 * Giải mã chuỗi Base32 RFC 4648 thành Buffer.
 * Ném ngoại lệ Error nếu chuỗi không hợp lệ hoặc chứa ký tự ngoài bảng mã.
 */
function decodeBase32(secret: string): Buffer {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Khóa bí mật Base32 không hợp lệ: chuỗi rỗng');
  }

  // Loại bỏ các ký tự padding '=' nếu có ở cuối
  const unpadded = secret.replace(/=+$/, '');
  if (unpadded.length === 0 || !/^[A-Z2-7]+$/.test(unpadded)) {
    throw new Error('Khóa bí mật Base32 không hợp lệ: chứa ký tự không thuộc bảng mã A-Z2-7');
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < unpadded.length; i++) {
    const charCode = unpadded.charCodeAt(i);
    let val: number;
    if (charCode >= 65 && charCode <= 90) {
      // 'A' - 'Z' -> 0 - 25
      val = charCode - 65;
    } else if (charCode >= 50 && charCode <= 55) {
      // '2' - '7' -> 26 - 31
      val = charCode - 50 + 26;
    } else {
      throw new Error(`Khóa bí mật Base32 không hợp lệ: ký tự không hợp lệ tại vị trí ${i}`);
    }

    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Tính mã HOTP theo RFC 4226: HMAC-SHA1 và Dynamic Truncation.
 */
function computeHotp(key: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac.readUInt8(hmac.length - 1) & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  const otp = binary % DIGITS_MODULO;

  return otp.toString().padStart(DIGITS, '0');
}

/**
 * Hiện thực TOTP theo RFC 6238 cho xác thực 2FA.
 * Sử dụng HMAC-SHA1, chu kỳ 30s, mã 6 chữ số và cửa sổ kiểm tra ±1 bước.
 */
export class Rfc6238Totp implements TotpService {
  /**
   * Sinh khóa bí mật ngẫu nhiên 20 bytes (160 bits), mã hóa Base32 RFC 4648 không padding.
   */
  generateSecret(): string {
    const bytes = randomBytes(20);
    return encodeBase32(bytes);
  }

  /**
   * Sinh mã TOTP 6 chữ số tại thời điểm cụ thể.
   */
  generate(secret: string, now: Date): string {
    const key = decodeBase32(secret);
    const unixSeconds = Math.floor(now.getTime() / 1000);
    const step = Math.floor(unixSeconds / PERIOD_SECONDS);
    return computeHotp(key, step);
  }

  /**
   * Xác thực mã TOTP với cửa sổ ±1 bước thời gian quanh `now`.
   * So sánh an toàn thời gian bằng timingSafeEqual.
   * Trả về số bước khớp hoặc null nếu không hợp lệ.
   */
  verify(secret: string, code: string, now: Date): number | null {
    const key = decodeBase32(secret);

    if (!/^\d{6}$/.test(code)) {
      return null;
    }

    const unixSeconds = Math.floor(now.getTime() / 1000);
    const currentStep = Math.floor(unixSeconds / PERIOD_SECONDS);
    const codeBuf = Buffer.from(code, 'utf8');

    // Kiểm tra cửa sổ ±1 bước: bước hiện tại, bước trước (-1), bước sau (+1)
    const candidateSteps = [currentStep, currentStep - 1, currentStep + 1];

    for (const step of candidateSteps) {
      if (step < 0) continue;
      const expected = Buffer.from(computeHotp(key, step), 'utf8');
      if (codeBuf.length === expected.length && timingSafeEqual(codeBuf, expected)) {
        return step;
      }
    }

    return null;
  }

  /**
   * Tạo URI otpauth://totp/... cho ứng dụng Authenticator quét mã QR.
   */
  otpauthUri(secret: string, accountName: string): string {
    // Kiểm tra tính hợp lệ của secret Base32
    decodeBase32(secret);
    const account = encodeURIComponent(accountName);
    return `otpauth://totp/TamGiao:${account}?secret=${secret}&issuer=TamGiao&algorithm=SHA1&digits=6&period=30`;
  }
}
