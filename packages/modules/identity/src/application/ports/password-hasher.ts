/** Băm mật khẩu admin (argon2id ở infrastructure). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /**
   * So khớp mật khẩu. `hash = null` (không có tài khoản) vẫn tốn thời gian như một lần so khớp thật rồi trả `false`
   * → thời gian phản hồi không tiết lộ email có tồn tại hay không.
   */
  verify(hash: string | null, password: string): Promise<boolean>;
}
