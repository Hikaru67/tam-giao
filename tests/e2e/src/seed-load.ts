/**
 * Seed dữ liệu cho k6 (BE-S7-09): `LOAD_PAIRS` cặp (mặc định 100 → 200 người dùng) đi hết onboarding qua HTTP
 * (OTP → hồ sơ → thanh toán → eKYC → chuyên viên duyệt → ghép → hai phía đồng ý) tới khi hội thoại mở.
 * Ghi `LOAD_OUTPUT` (JSON, chứa access token — chỉ để ở thư mục chạy local, không commit) cho `tests/load/chat-and-api.js`.
 *
 * Token truy cập sống 15 phút: cuối bước seed làm mới token cho mọi người dùng → chạy k6 ngay sau seed.
 * Biến môi trường như `full-flow.ts`, thêm `LOAD_PAIRS`, `LOAD_CONCURRENCY` (mặc định 10), `LOAD_OUTPUT`.
 */
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  acceptBoth,
  adminLogin,
  approveKyc,
  completeProfile,
  fakeIp,
  payVerification,
  proposeMatch,
  randomPhone,
  registerUsers,
  runTag,
  submitKyc,
  waitConversation,
  type FlowConfig,
  type UserSession,
  type UserSpec,
} from './lib/flow.js';
import { ApiClient } from './lib/http.js';
import { otpSourceFromEnv } from './lib/otp.js';

export interface LoadUser {
  readonly userId: string;
  readonly accessToken: string;
  readonly conversationId: string;
  readonly peerUserId: string;
  /** Mọi người dùng ảo cùng một IP (k6) → gửi `x-forwarded-for` riêng để không chung hạn mức theo IP. */
  readonly forwardedFor: string;
}

const out = (line: string): void => void process.stdout.write(`${line}\n`);

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`thiếu biến môi trường ${name}`);
  return value;
}

/** Chạy `fn` cho từng phần tử, tối đa `limit` cùng lúc, giữ thứ tự kết quả. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const env = process.env;
  const pairs = Number(env.LOAD_PAIRS ?? 100);
  const concurrency = Number(env.LOAD_CONCURRENCY ?? 10);
  const output = env.LOAD_OUTPUT ?? 'load-users.json';
  const api = new ApiClient(env.E2E_BASE_URL ?? 'http://localhost:3100');
  const config: FlowConfig = {
    api,
    otp: otpSourceFromEnv(env),
    webhookSecret: env.E2E_WEBHOOK_SECRET || undefined,
    paymentGateway: env.E2E_PAYMENT_GATEWAY ?? 'fake',
    eventTimeoutMs: Number(env.E2E_EVENT_TIMEOUT_MS ?? 60_000),
  };
  const tag = runTag();
  const startedAt = Date.now();
  const elapsed = () => `${((Date.now() - startedAt) / 1_000).toFixed(0)}s`;

  const admin = await adminLogin(api, {
    email: required(env, 'E2E_ADMIN_EMAIL'),
    password: required(env, 'E2E_ADMIN_PASSWORD'),
    totpSecret: required(env, 'E2E_ADMIN_TOTP_SECRET'),
  });

  // Nhóm 2 cặp / lô OTP để mỗi lần đọc log phục vụ nhiều người.
  const specs: UserSpec[] = Array.from({ length: pairs * 2 }, (_, i) => ({
    fullName: `Load ${tag} ${String(i).padStart(4, '0')}`,
    gender: i % 2 === 0 ? 'male' : 'female',
    phone: randomPhone(),
    forwardedFor: fakeIp(i + 1),
  }));
  const batches: UserSpec[][] = [];
  for (let i = 0; i < specs.length; i += 20) batches.push(specs.slice(i, i + 20));
  const users = (await mapLimit(batches, 2, (batch) => registerUsers(config, batch))).flat();
  out(`[${elapsed()}] đăng ký OTP: ${users.length} người dùng`);

  await mapLimit(users, concurrency, async (u) => {
    await completeProfile(u);
    await payVerification(config, u);
    await submitKyc(u);
  });
  out(`[${elapsed()}] hồ sơ + thanh toán + eKYC xong`);

  // Chuyên viên duyệt tuần tự (giống thao tác tay, tránh tranh khoá cùng hàng chờ).
  for (const u of users) await approveKyc(admin, u);
  out(`[${elapsed()}] chuyên viên duyệt ${users.length} hồ sơ`);

  const pairsOf: [UserSession, UserSession][] = [];
  for (let i = 0; i < users.length; i += 2)
    pairsOf.push([users[i] as UserSession, users[i + 1] as UserSession]);
  const conversations = await mapLimit(pairsOf, concurrency, async ([a, b]) => {
    await proposeMatch(config, admin, a, b);
    const status = await acceptBoth(a, b);
    if (status !== 'DATING') throw new Error(`cặp không vào DATING: ${status}`);
    return waitConversation(config, a, b.userId);
  });
  out(`[${elapsed()}] ${conversations.length} cặp DATING, hội thoại đã mở`);

  // Làm mới token (15 phút) ngay trước khi giao cho k6.
  const loadUsers: LoadUser[] = await mapLimit(users, concurrency, async (u, i) => {
    const tokens = await u.http.post<{ accessToken: string }>('/auth/refresh', {
      refreshToken: u.refreshToken,
    });
    const pairIndex = Math.floor(i / 2);
    const peer = pairsOf[pairIndex]?.[i % 2 === 0 ? 1 : 0] as UserSession;
    return {
      userId: u.userId,
      accessToken: tokens.accessToken,
      conversationId: conversations[pairIndex] as string,
      peerUserId: peer.userId,
      forwardedFor: u.spec.forwardedFor ?? fakeIp(i + 1),
    };
  });
  await writeFile(output, JSON.stringify(loadUsers), { mode: 0o600 });
  out(`[${elapsed()}] đã ghi ${loadUsers.length} người dùng ảo → ${output}`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  try {
    await main();
  } catch (error) {
    out(`SEED FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
