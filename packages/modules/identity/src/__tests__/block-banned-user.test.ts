import { FakeClock, newId, type Tx } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { BlockBannedUser } from '../application/use-cases/block-banned-user.js';
import { Session, type SessionId } from '../domain/session.js';
import type { UserId } from '../domain/user.js';
import { InMemoryBannedUserRegistry, InMemorySessionRepository } from './fakes.js';

const NOW = new Date('2026-11-21T03:00:00.000Z');
const tx = {} as Tx;

function setup() {
  const clock = new FakeClock(NOW);
  const sessions = new InMemorySessionRepository();
  const bannedUsers = new InMemoryBannedUserRegistry();
  const block = new BlockBannedUser({ clock, sessions, bannedUsers });
  return { clock, sessions, bannedUsers, block };
}

async function addSession(repo: InMemorySessionRepository, userId: UserId): Promise<SessionId> {
  const session = Session.start({ id: newId<'Session'>(), userId, deviceName: null }, NOW);
  await repo.save(tx, session);
  return session.id;
}

describe('BlockBannedUser (UserBanned → identity, BE-S6-06)', () => {
  it('thu hồi mọi phiên đang hoạt động của user (lý do USER_BANNED) + đánh dấu bị khoá; phiên người khác giữ nguyên', async () => {
    const t = setup();
    const userId = newId<'User'>() as UserId;
    const other = newId<'User'>() as UserId;
    const s1 = await addSession(t.sessions, userId);
    const s2 = await addSession(t.sessions, userId);
    const s3 = await addSession(t.sessions, other);

    t.clock.advance({ minutes: 1 });
    expect(await t.block.handle(tx, { userId })).toBe(2);

    for (const id of [s1, s2]) {
      expect(t.sessions.table.rows.get(id)).toMatchObject({
        revokedAt: t.clock.now(),
        revokeReason: 'USER_BANNED',
      });
    }
    expect(t.sessions.table.rows.get(s3)?.revokedAt).toBeNull();
    expect(await t.bannedUsers.isBanned(tx, userId)).toBe(true);
    expect(await t.bannedUsers.isBanned(tx, other)).toBe(false);
  });

  it('idempotent (A9): chạy lại không thu hồi thêm, giữ thời điểm khoá đầu tiên', async () => {
    const t = setup();
    const userId = newId<'User'>() as UserId;
    await addSession(t.sessions, userId);
    await t.block.handle(tx, { userId });
    t.clock.advance({ hours: 1 });
    expect(await t.block.handle(tx, { userId })).toBe(0);
    expect(t.bannedUsers.table.rows.get(userId)).toEqual(NOW);
  });
});
