/** Băm PIN nhân viên quán (scrypt + pepper ở infrastructure). PIN gốc không bao giờ được lưu hay log. */
export interface PartnerPinHasher {
  hash(pin: string): Promise<string>;
  /**
   * So khớp PIN. `hash = null` (không có tài khoản) vẫn tốn thời gian như một lần so khớp thật rồi trả `false`
   * → thời gian phản hồi không tiết lộ mã nhân viên có tồn tại hay không.
   */
  verify(hash: string | null, pin: string): Promise<boolean>;
}
