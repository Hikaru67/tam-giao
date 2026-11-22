import { verifyOtpResponseSchema } from '@tamgiao/contracts';
import { DrizzleUnitOfWork, createDatabase, type Database } from '@tamgiao/db';
import { FakeClock, addDuration, newId } from '@tamgiao/kernel';
import { resetDatabase, testDatabaseUrl } from '@tamgiao/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paramEndpointKeys, type RouteKey } from '../route-audit.js';
import { buildTestApi, type TestApi } from './api-harness.js';

/**
 * BE-S7-07 — AC2: test IDOR theo bảng route trên **app thật** của apps/api (`buildModules`, Postgres thật, Fake SMS/S3/
 * Redis). Mỗi dòng của bảng: tạo tài nguyên cho chủ sở hữu (owner) và một tài nguyên tương đương cho kẻ tấn công
 * (attacker — để attacker ở trạng thái hợp lệ, bị từ chối chỉ vì không sở hữu), rồi:
 *   1. attacker gọi route với id của owner → 403/404, không lộ id của owner, không đổi dữ liệu nào trong DB;
 *   2. owner gọi cùng route → `ownerStatus` (đối chứng: seed hợp lệ, route thật sự hoạt động).
 * Bảng phải phủ **mọi** route `/me/*` có tham số đường dẫn — route mới chưa có trong bảng → test fail.
 */

interface Actor {
  readonly userId: string;
  readonly token: string;
}

interface SeedContext {
  readonly now: Date;
  readonly sql: <T extends object = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<T[]>;
  /** Gọi API với tư cách `actor` (dùng khi seed qua HTTP dễ hơn SQL). */
  readonly request: (actor: Actor, method: string, path: string, body?: unknown) => Promise<Response>;
}

interface IdorCase {
  readonly route: RouteKey;
  /**
   * Body gửi kèm (route POST/PUT); bỏ trống = không gửi body. Dạng hàm: dựng từ giá trị seed của **chủ sở hữu**
   * (vd id tin nhắn trong hội thoại của chủ).
   */
  readonly body?: unknown;
  /**
   * Tạo tài nguyên của `user` (cặp với `peer` nếu tài nguyên thuộc về hai người) ở trạng thái mà chính `user` gọi route
   * thành công; trả giá trị từng tham số đường dẫn (`{ id: '…' }`) + giá trị phụ cho `body` nếu cần.
   */
  readonly seed: (ctx: SeedContext, user: Actor, peer: Actor) => Promise<Record<string, string>>;
  /** Status khi chính chủ gọi. */
  readonly ownerStatus: number;
  /**
   * Status chấp nhận khi kẻ tấn công gọi (mặc định 403/404). Chỉ nới cho thao tác xoá **idempotent theo chủ sở hữu**
   * (xoá `where id = … and user_id = …`, không có gì → vẫn 204): an toàn vì snapshot DB chứng minh không đổi gì.
   */
  readonly attackerStatuses?: readonly number[];
}

const T0 = new Date('2026-12-01T02:00:00.000Z');
const clock = new FakeClock(T0);
let database: Database;
let api: TestApi;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { maxConnections: 10 });
  api = buildTestApi({ uow: new DrizzleUnitOfWork(database.pool), clock });
});
afterAll(() => database.close());

const sql = async <T extends object = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  (await database.pool.query<T>(text, params)).rows;

async function request(actor: Actor | null, method: string, path: string, body?: unknown): Promise<Response> {
  return api.app.request(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(actor ? { authorization: `Bearer ${actor.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

let phoneSeq = 0;
/** Đăng nhập OTP thật (SMS giả); cách nhau > 60s để không vướng giới hạn OTP theo IP. */
async function login(): Promise<Actor> {
  clock.advance({ seconds: 61 });
  const phone = `09${String(10_000_000 + (phoneSeq++ % 89_999_999)).padStart(8, '0')}`;
  const requested = await request(null, 'POST', '/auth/otp/request', { phone });
  expect(requested.status).toBe(200);
  const code = /(?<!\d)(\d{6})(?!\d)/.exec(api.sms.at(-1)?.text ?? '')?.[1] ?? '';
  const verified = await request(null, 'POST', '/auth/otp/verify', { phone, code });
  expect(verified.status).toBe(200);
  const body = verifyOtpResponseSchema.parse(await verified.json());
  return { userId: body.userId, token: body.tokens.accessToken };
}

/** Toàn bộ dữ liệu ứng dụng (mọi schema module) — để chứng minh request bị từ chối không đổi gì. */
async function snapshotDatabase(): Promise<Record<string, unknown[]>> {
  const tables = await sql<{ name: string }>(
    `select table_schema || '.' || table_name as name from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('drizzle', 'pgboss', 'pg_catalog', 'information_schema', 'public')
        and table_schema not like 'pg_%'
      order by 1`,
  );
  const snapshot: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    const [schema, table] = name.split('.');
    snapshot[name] = await sql(`select * from "${schema}"."${table}" order by 1`);
  }
  return snapshot;
}

const fillPath = (path: string, params: Record<string, string>) =>
  path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`seed thiếu tham số ${name} cho ${path}`);
    return value;
  });

/** Tiện ích seed dùng chung giữa các dòng. */
const seeds = {
  async dataExport(ctx: SeedContext, user: Actor) {
    const res = await ctx.request(user, 'POST', '/me/data-exports');
    expect(res.status).toBe(202);
    return { exportId: ((await res.json()) as { exportId: string }).exportId };
  },

  async device(ctx: SeedContext, user: Actor) {
    const res = await ctx.request(user, 'POST', '/me/devices', {
      token: `ExponentPushToken[${newId()}]`,
      platform: 'android',
    });
    expect(res.status).toBe(201);
    return { deviceId: ((await res.json()) as { deviceId: string }).deviceId };
  },

  /** Tạo voucher ACTIVE và payment SUCCEEDED tương ứng cho người dùng. */
  async voucher(ctx: SeedContext, user: Actor) {
    const paymentId = newId();
    const voucherId = newId();
    await ctx.sql(
      `insert into billing.payments (id, order_id, user_id, amount, status, gateway_txn_id, idempotency_key, created_at, succeeded_at, updated_at, version)
       values ($1, $2, $3, 299000, 'SUCCEEDED', $4, $5, $6, $6, $6, 1)`,
      [
        paymentId,
        `VP${newId().replaceAll('-', '')}`,
        user.userId,
        `txn_${newId()}`,
        `idem_${newId()}`,
        ctx.now,
      ],
    );
    await ctx.sql(
      `insert into billing.vouchers (id, user_id, payment_id, value, status, expires_at, issued_at, updated_at, version)
       values ($1, $2, $3, 300000, 'ACTIVE', $4, $5, $5, 1)`,
      [voucherId, user.userId, paymentId, addDuration(ctx.now, { days: 30 }), ctx.now],
    );
    return { id: voucherId };
  },

  /** Hội thoại OPEN giữa user và peer kèm một tin của peer (`messageId` cho body route đánh dấu đã đọc). */
  async conversation(ctx: SeedContext, user: Actor, peer: Actor) {
    const conversationId = newId();
    const matchId = newId();
    await ctx.sql(
      `insert into messaging.conversations (id, match_id, user_a, user_b, status, opened_at, closes_at, updated_at, version)
       values ($1, $2, $3, $4, 'OPEN', $5, $6, $5, 1)`,
      [
        conversationId,
        matchId,
        user.userId,
        peer.userId,
        addDuration(ctx.now, { days: -1 }),
        addDuration(ctx.now, { days: 13 }),
      ],
    );
    const messageId = newId();
    await ctx.sql(
      `insert into messaging.messages (id, conversation_id, sender_id, kind, body, sent_at)
       values ($1, $2, $3, 'TEXT', 'Xin chào!', $4)`,
      [messageId, conversationId, peer.userId, ctx.now],
    );
    return { id: conversationId, messageId };
  },

  /** Tạo quán đối tác an toàn đang active trong billing.partners. */
  async partner(ctx: SeedContext): Promise<string> {
    const partnerId = newId();
    await ctx.sql(
      `insert into billing.partners (id, name, address, active, created_at, updated_at)
       values ($1, 'The Running Bean', '115 Hồ Tùng Mậu', true, $2, $2)`,
      [partnerId, ctx.now],
    );
    return partnerId;
  },

  /** Tạo match DATING giữa user và peer trong matching.matches + active_slots. */
  async datingMatch(ctx: SeedContext, user: Actor, peer: Actor): Promise<string> {
    const matchId = newId();
    const datingStartedAt = addDuration(ctx.now, { days: -2 });
    await ctx.sql(
      `insert into matching.matches (id, user_a, user_b, created_by, status, accepted_by, offered_at, expires_at, dating_started_at, updated_at, version)
       values ($1, $2, $3, $4, 'DATING', $5, $6, $7, $6, $6, 3)`,
      [
        matchId,
        user.userId,
        peer.userId,
        newId(),
        [user.userId, peer.userId],
        datingStartedAt,
        addDuration(ctx.now, { days: 12 }),
      ],
    );
    await ctx.sql(
      `insert into matching.active_slots (user_id, match_id, claimed_at) values ($1, $3, $4), ($2, $3, $4)`,
      [user.userId, peer.userId, matchId, datingStartedAt],
    );
    return matchId;
  },

  /** Tạo bản ghi date_plans theo các tham số tuỳ biến. */
  async datePlan(
    ctx: SeedContext,
    params: {
      readonly matchId: string;
      readonly inviterId: string;
      readonly inviteeId: string;
      readonly partnerId: string;
      readonly status: string;
      readonly startsAt: Date;
      readonly endsAt: Date;
      readonly proposedAt: Date;
      readonly expiresAt: Date;
      readonly respondedAt?: Date | null;
    },
  ): Promise<string> {
    const datePlanId = newId();
    await ctx.sql(
      `insert into dating.date_plans (id, match_id, inviter_id, invitee_id, partner_id, starts_at, ends_at, staff_booking_requested, status, proposed_at, expires_at, responded_at, updated_at, version)
       values ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, $11, $9, 1)`,
      [
        datePlanId,
        params.matchId,
        params.inviterId,
        params.inviteeId,
        params.partnerId,
        params.startsAt,
        params.endsAt,
        params.status,
        params.proposedAt,
        params.expiresAt,
        params.respondedAt ?? null,
      ],
    );
    return datePlanId;
  },
};

/**
 * Bảng route IDOR. Mỗi route `/me/*` có tham số phải có đúng một dòng. Thêm route mới → thêm dòng (seed + ownerStatus).
 */
const IDOR_CASES: readonly IdorCase[] = [
  {
    route: 'GET /me/data-exports/:exportId',
    seed: (ctx, user) => seeds.dataExport(ctx, user),
    ownerStatus: 200,
  },
  {
    route: 'DELETE /me/devices/:deviceId',
    seed: (ctx, user) => seeds.device(ctx, user),
    ownerStatus: 204,
    // Huỷ đăng ký thiết bị idempotent (BE-S7-05): xoá theo (deviceId, userId) → thiết bị người khác không bị đụng tới.
    attackerStatuses: [204, 403, 404],
  },
  {
    route: 'GET /me/vouchers/:id/qr',
    seed: (ctx, user) => seeds.voucher(ctx, user),
    ownerStatus: 200,
  },
  {
    route: 'GET /me/conversations/:id/messages',
    seed: (ctx, user, peer) => seeds.conversation(ctx, user, peer),
    ownerStatus: 200,
  },
  {
    route: 'POST /me/conversations/:id/read',
    body: (params: Record<string, string>) => ({ messageId: params.messageId }),
    seed: (ctx, user, peer) => seeds.conversation(ctx, user, peer),
    ownerStatus: 200,
  },
  {
    route: 'GET /me/conversations/:id/icebreakers',
    seed: (ctx, user, peer) => seeds.conversation(ctx, user, peer),
    ownerStatus: 200,
  },
  {
    route: 'POST /me/dates/:id/confirm',
    seed: async (ctx, user, peer) => {
      const matchId = await seeds.datingMatch(ctx, peer, user);
      const partnerId = await seeds.partner(ctx);
      const id = await seeds.datePlan(ctx, {
        matchId,
        inviterId: peer.userId,
        inviteeId: user.userId,
        partnerId,
        status: 'PROPOSED',
        startsAt: addDuration(ctx.now, { days: 2 }),
        endsAt: addDuration(ctx.now, { days: 2, hours: 2 }),
        proposedAt: addDuration(ctx.now, { hours: -1 }),
        expiresAt: addDuration(ctx.now, { hours: 23 }),
      });
      return { id };
    },
    ownerStatus: 200,
  },
  {
    route: 'POST /me/dates/:id/decline',
    seed: async (ctx, user, peer) => {
      const matchId = await seeds.datingMatch(ctx, peer, user);
      const partnerId = await seeds.partner(ctx);
      const id = await seeds.datePlan(ctx, {
        matchId,
        inviterId: peer.userId,
        inviteeId: user.userId,
        partnerId,
        status: 'PROPOSED',
        startsAt: addDuration(ctx.now, { days: 2 }),
        endsAt: addDuration(ctx.now, { days: 2, hours: 2 }),
        proposedAt: addDuration(ctx.now, { hours: -1 }),
        expiresAt: addDuration(ctx.now, { hours: 23 }),
      });
      return { id };
    },
    ownerStatus: 200,
  },
  {
    route: 'POST /me/dates/:id/cancel',
    seed: async (ctx, user, peer) => {
      const matchId = await seeds.datingMatch(ctx, user, peer);
      const partnerId = await seeds.partner(ctx);
      const id = await seeds.datePlan(ctx, {
        matchId,
        inviterId: user.userId,
        inviteeId: peer.userId,
        partnerId,
        status: 'CONFIRMED',
        startsAt: addDuration(ctx.now, { days: 2 }),
        endsAt: addDuration(ctx.now, { days: 2, hours: 2 }),
        proposedAt: addDuration(ctx.now, { hours: -2 }),
        expiresAt: addDuration(ctx.now, { hours: 1 }),
        respondedAt: addDuration(ctx.now, { hours: -1 }),
      });
      return { id };
    },
    ownerStatus: 200,
  },
  {
    route: 'POST /me/dates/:id/check-in',
    body: {},
    seed: async (ctx, user, peer) => {
      const matchId = await seeds.datingMatch(ctx, user, peer);
      const partnerId = await seeds.partner(ctx);
      const id = await seeds.datePlan(ctx, {
        matchId,
        inviterId: user.userId,
        inviteeId: peer.userId,
        partnerId,
        status: 'CONFIRMED',
        startsAt: addDuration(ctx.now, { minutes: -10 }),
        endsAt: addDuration(ctx.now, { minutes: 110 }),
        proposedAt: addDuration(ctx.now, { hours: -2 }),
        expiresAt: addDuration(ctx.now, { minutes: -30 }),
        respondedAt: addDuration(ctx.now, { minutes: -40 }),
      });
      return { id };
    },
    ownerStatus: 201,
  },
  {
    route: 'POST /me/dates/:id/check-out',
    seed: async (ctx, user, peer) => {
      const matchId = await seeds.datingMatch(ctx, user, peer);
      const partnerId = await seeds.partner(ctx);
      const endsAt = addDuration(ctx.now, { minutes: 90 });
      const id = await seeds.datePlan(ctx, {
        matchId,
        inviterId: user.userId,
        inviteeId: peer.userId,
        partnerId,
        status: 'CHECKED_IN',
        startsAt: addDuration(ctx.now, { minutes: -30 }),
        endsAt,
        proposedAt: addDuration(ctx.now, { hours: -2 }),
        expiresAt: addDuration(ctx.now, { minutes: -40 }),
        respondedAt: addDuration(ctx.now, { minutes: -50 }),
      });
      const checkInId = newId();
      const checkedInAt = addDuration(ctx.now, { minutes: -20 });
      const overdueAt = addDuration(endsAt, { minutes: 60 });
      await ctx.sql(
        `insert into dating.safety_check_ins (id, date_plan_id, match_id, user_id, partner_id, source, checked_in_at, date_ends_at, overdue_at, checked_out_at, overdue_alerted_at, location_shared, updated_at, version)
         values ($1, $2, $3, $4, $5, 'MANUAL', $6, $7, $8, null, null, false, $6, 1)`,
        [checkInId, id, matchId, user.userId, partnerId, checkedInAt, endsAt, overdueAt],
      );
      return { id };
    },
    ownerStatus: 200,
  },
  {
    route: 'GET /me/dates/:id/check-in',
    seed: async (ctx, user, peer) => {
      const matchId = await seeds.datingMatch(ctx, user, peer);
      const partnerId = await seeds.partner(ctx);
      const id = await seeds.datePlan(ctx, {
        matchId,
        inviterId: user.userId,
        inviteeId: peer.userId,
        partnerId,
        status: 'CONFIRMED',
        startsAt: addDuration(ctx.now, { days: 2 }),
        endsAt: addDuration(ctx.now, { days: 2, hours: 2 }),
        proposedAt: addDuration(ctx.now, { hours: -2 }),
        expiresAt: addDuration(ctx.now, { hours: 1 }),
        respondedAt: addDuration(ctx.now, { hours: -1 }),
      });
      return { id };
    },
    ownerStatus: 200,
  },
  {
    route: 'POST /me/dates/:id/feedback',
    body: {
      rating: 5,
      profileMatch: 'FULL_MATCH',
      feeling: 'DEEP_INTEREST',
      decision: 'A_COMMIT',
      stopReasons: [],
      stopNote: null,
    },
    seed: async (ctx, user, peer) => {
      const matchId = await seeds.datingMatch(ctx, user, peer);
      const partnerId = await seeds.partner(ctx);
      const id = await seeds.datePlan(ctx, {
        matchId,
        inviterId: user.userId,
        inviteeId: peer.userId,
        partnerId,
        status: 'CONFIRMED',
        startsAt: addDuration(ctx.now, { hours: -3 }),
        endsAt: addDuration(ctx.now, { hours: -1 }),
        proposedAt: addDuration(ctx.now, { days: -2 }),
        expiresAt: addDuration(ctx.now, { days: -1 }),
        respondedAt: addDuration(ctx.now, { days: -1, hours: -1 }),
      });
      return { id };
    },
    ownerStatus: 201,
  },
  {
    route: 'GET /me/dates/:id/feedback',
    seed: async (ctx, user, peer) => {
      const matchId = await seeds.datingMatch(ctx, user, peer);
      const partnerId = await seeds.partner(ctx);
      const id = await seeds.datePlan(ctx, {
        matchId,
        inviterId: user.userId,
        inviteeId: peer.userId,
        partnerId,
        status: 'CONFIRMED',
        startsAt: addDuration(ctx.now, { hours: -3 }),
        endsAt: addDuration(ctx.now, { hours: -1 }),
        proposedAt: addDuration(ctx.now, { days: -2 }),
        expiresAt: addDuration(ctx.now, { days: -1 }),
        respondedAt: addDuration(ctx.now, { days: -1, hours: -1 }),
      });
      return { id };
    },
    ownerStatus: 200,
  },
];

/** Route của chính người dùng nằm ngoài `/me` nhưng cũng nhận id — kiểm tra cùng cơ chế. */
const EXTRA_CASES: readonly IdorCase[] = [
  {
    route: 'DELETE /auth/sessions/:sessionId',
    seed: async (ctx, user) => {
      const res = await ctx.request(user, 'GET', '/auth/sessions');
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as { items: { id: string }[] };
      const sessionId = items[0]?.id;
      if (!sessionId) throw new Error('không có phiên');
      return { sessionId };
    },
    ownerStatus: 204,
  },
];

describe('AC2 — bảng IDOR phủ mọi route /me/* có tham số', () => {
  it('mỗi route /me/* có tham số có đúng một dòng trong bảng (route mới → thêm dòng)', () => {
    const routes = paramEndpointKeys(api.app.routes, '/me/').sort();
    const table = IDOR_CASES.map((c) => c.route).sort();
    expect(new Set(table).size).toBe(table.length);
    expect(table).toEqual(routes);
  });
});

describe.each([...IDOR_CASES, ...EXTRA_CASES])('AC2 — IDOR $route', (testCase) => {
  it('user khác gọi với id của chủ sở hữu → 403/404, không lộ, không đổi dữ liệu; chủ sở hữu gọi được', async () => {
    await resetDatabase(database.pool);
    clock.set(T0);
    const [owner, ownerPeer, attacker, attackerPeer] = [
      await login(),
      await login(),
      await login(),
      await login(),
    ];
    const ctx: SeedContext = { now: clock.now(), sql, request };

    const ownerParams = await testCase.seed(ctx, owner, ownerPeer);
    await testCase.seed(ctx, attacker, attackerPeer);
    const [method, pattern] = testCase.route.split(' ') as [string, string];
    const path = fillPath(pattern, ownerParams);

    const body = typeof testCase.body === 'function' ? testCase.body(ownerParams) : testCase.body;

    const before = await snapshotDatabase();
    const attack = await request(attacker, method, path, body);
    const attackText = await attack.text();
    expect(
      testCase.attackerStatuses ?? [403, 404],
      `${testCase.route} → ${attack.status} ${attackText}`,
    ).toContain(attack.status);
    for (const secret of [owner.userId, ownerPeer.userId]) expect(attackText).not.toContain(secret);
    expect(await snapshotDatabase()).toEqual(before);

    const own = await request(owner, method, path, body);
    expect(own.status, `${testCase.route} (chủ sở hữu) → ${await own.clone().text()}`).toBe(
      testCase.ownerStatus,
    );
  });
});
