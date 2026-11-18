import type { Tx } from '@tamgiao/kernel';
import type { OtpChallenge } from '../../domain/otp-challenge.js';

export interface OtpChallengeRepository {
  /** Đọc và **khoá dòng** challenge của SĐT tới hết `tx` — chặn đoán mã song song vượt giới hạn số lần sai. */
  findByPhoneForUpdate(tx: Tx, phoneIndex: string): Promise<OtpChallenge | null>;
  /** Ghi đè challenge hiện có của SĐT (mỗi SĐT chỉ một challenge). */
  save(tx: Tx, challenge: OtpChallenge): Promise<void>;
}
