import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { eq } from 'drizzle-orm';
import type { OtpChallengeRepository } from '../application/ports/otp-challenge-repository.js';
import { OtpChallenge, type OtpChallengeId } from '../domain/otp-challenge.js';
import { otpChallenges } from './schema.js';

export class DrizzleOtpChallengeRepository implements OtpChallengeRepository {
  async findByPhoneForUpdate(tx: Tx, phoneIndex: string): Promise<OtpChallenge | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.phoneBidx, phoneIndex))
      .for('update');
    if (!row) return null;
    return OtpChallenge.restore({
      id: row.id as OtpChallengeId,
      phoneIndex: row.phoneBidx,
      codeHash: row.codeHash,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      failedAttempts: row.failedAttempts,
      consumedAt: row.consumedAt,
    });
  }

  async save(tx: Tx, challenge: OtpChallenge): Promise<void> {
    const s = challenge.toState();
    const values = {
      id: s.id,
      codeHash: s.codeHash,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      failedAttempts: s.failedAttempts,
      consumedAt: s.consumedAt,
    };
    await asDbTx(tx)
      .insert(otpChallenges)
      .values({ phoneBidx: s.phoneIndex, ...values })
      .onConflictDoUpdate({ target: otpChallenges.phoneBidx, set: values });
  }
}
