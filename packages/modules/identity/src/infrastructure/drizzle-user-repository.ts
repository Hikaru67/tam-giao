import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import type { BlindIndexer, Encryptor, Tx } from '@tamgiao/kernel';
import { eq } from 'drizzle-orm';
import { PHONE_INDEX_PURPOSE } from '../application/index-purposes.js';
import type { UserRepository } from '../application/ports/user-repository.js';
import { PhoneNumber } from '../domain/phone-number.js';
import { User, type UserId } from '../domain/user.js';
import { users } from './schema.js';

const phoneContext = (userId: string) => `identity.users.phone:${userId}`;

export class DrizzleUserRepository implements UserRepository {
  constructor(
    private readonly encryptor: Encryptor,
    private readonly blindIndexer: BlindIndexer,
    private readonly outbox: OutboxWriter,
  ) {}

  async findByPhone(tx: Tx, phone: PhoneNumber): Promise<User | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(users)
      .where(eq(users.phoneBidx, this.blindIndexer.index(phone.e164, PHONE_INDEX_PURPOSE)));
    if (!row) return null;

    const stored = PhoneNumber.parse(await this.encryptor.decrypt(row.phoneEnc, phoneContext(row.id)));
    if (stored.isErr()) throw new Error(`identity.users ${row.id}: SĐT lưu trong DB không hợp lệ`);
    return User.restore({
      id: row.id as UserId,
      phone: stored.value,
      createdAt: row.createdAt,
      version: row.version,
    });
  }

  async save(tx: Tx, user: User): Promise<void> {
    // User hiện chỉ có thao tác tạo mới; SĐT trùng → vi phạm unique `users_phone_bidx_uq` (throw, rollback).
    await asDbTx(tx)
      .insert(users)
      .values({
        id: user.id,
        phoneEnc: await this.encryptor.encrypt(user.phone.e164, phoneContext(user.id)),
        phoneBidx: this.blindIndexer.index(user.phone.e164, PHONE_INDEX_PURPOSE),
        version: user.version,
        createdAt: user.createdAt,
      });
    await this.outbox.append(tx, user.pullEvents());
  }
}
