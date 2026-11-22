import { asDbTx, type OutboxWriter } from '@tamgiao/db';
import type { BlindIndexer, Encryptor, Tx } from '@tamgiao/kernel';
import { and, eq, isNull } from 'drizzle-orm';
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
    return row ? this.toUser(row) : null;
  }

  async findActiveById(tx: Tx, id: UserId): Promise<User | null> {
    const [row] = await asDbTx(tx)
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    return row ? this.toUser(row) : null;
  }

  async anonymize(tx: Tx, id: UserId, now: Date): Promise<void> {
    // Blind index là HMAC (base64url) nên không bao giờ trùng `deleted:<uuid>`.
    await asDbTx(tx)
      .update(users)
      .set({ phoneEnc: Buffer.alloc(0), phoneBidx: `deleted:${id}`, deletedAt: now })
      .where(eq(users.id, id));
  }

  private async toUser(row: typeof users.$inferSelect): Promise<User> {
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
