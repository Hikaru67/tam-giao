import { asDbTx } from '@tamgiao/db';
import type { Encryptor, Tx } from '@tamgiao/kernel';
import { lte } from 'drizzle-orm';
import type { CheckInLocationStore } from '../application/ports/safety-check-in-repository.js';
import type { GeoPoint } from '../domain/geo-point.js';
import type { SafetyCheckInId } from '../domain/safety-check-in.js';
import { checkInLocations } from './schema.js';

/** Context mã hoá vị trí thô gắn với checkInId (AGENTS.md mục 5). */
export function checkInLocationContext(checkInId: string): string {
  return `dating.check_in_locations:${checkInId}`;
}

/**
 * Hiện thực `CheckInLocationStore` trên `dating.check_in_locations`.
 * Vị trí là dữ liệu cá nhân: mã hoá qua `Encryptor`, không log, tự xoá sau thời hạn lưu trữ.
 */
export class DrizzleCheckInLocationStore implements CheckInLocationStore {
  constructor(private readonly encryptor: Encryptor) {}

  async record(
    tx: Tx,
    input: {
      readonly checkInId: SafetyCheckInId;
      readonly location: GeoPoint;
      readonly recordedAt: Date;
      readonly purgeAfter: Date;
    },
  ): Promise<void> {
    const locationEnc = await this.encryptor.encrypt(
      input.location.serialize(),
      checkInLocationContext(input.checkInId),
    );
    await asDbTx(tx).insert(checkInLocations).values({
      checkInId: input.checkInId,
      locationEnc,
      recordedAt: input.recordedAt,
      purgeAfter: input.purgeAfter,
    });
  }

  async purgeExpired(tx: Tx, now: Date): Promise<number> {
    const deleted = await asDbTx(tx)
      .delete(checkInLocations)
      .where(lte(checkInLocations.purgeAfter, now))
      .returning({ checkInId: checkInLocations.checkInId });
    return deleted.length;
  }
}
