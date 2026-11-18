/** TOTP (RFC 6238) cho 2FA của admin: HMAC-SHA1, bước 30 giây, 6 chữ số. */
export interface TotpService {
  /** Sinh secret ngẫu nhiên (≥ 160 bit), mã hoá base32 không padding. */
  generateSecret(): string;
  /**
   * Trả về số bước thời gian (`floor(unixSeconds / 30)`) mà `code` khớp, xét cửa sổ ±1 bước quanh `now`;
   * không khớp hoặc `code` sai định dạng → `null`. Caller dùng số bước để chặn dùng lại cùng một mã.
   */
  verify(secret: string, code: string, now: Date): number | null;
  /** URI `otpauth://totp/...` để app Authenticator quét QR. */
  otpauthUri(secret: string, accountName: string): string;
}
