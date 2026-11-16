/** Sinh và băm mã OTP. Mã chỉ tồn tại dạng rõ trong bộ nhớ lúc gửi SMS; DB chỉ lưu hash. */
export interface OtpSecrets {
  /** Mã số ngẫu nhiên (CSPRNG) dài `OTP_LENGTH`. */
  generate(): string;
  /** Hash có khoá bí mật của server; `salt` (id challenge) để cùng một mã cho ra hash khác nhau mỗi lần. */
  hash(code: string, salt: string): string;
  /** So khớp thời gian hằng. */
  matches(code: string, salt: string, hash: string): boolean;
}
