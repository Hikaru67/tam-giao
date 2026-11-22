/**
 * Seed dữ liệu Backend local theo kịch bản cho Frontend dev (FE-S1-05).
 *
 * Chạy từ thư mục tools:
 *   node --env-file-if-exists=../.env --import tsx scripts/seed-fe.ts <scenario>
 *
 * Hoặc qua script pnpm ở root:
 *   pnpm seed:fe <scenario>
 *
 * Kịch bản hỗ trợ:
 *   - onboarded: 1 user đã đăng nhập OTP + hồ sơ đầy đủ + tiêu chí (chưa thanh toán).
 *   - verified: 1 user đã thanh toán (cổng giả) + eKYC + admin duyệt -> ACTIVE.
 *   - offered: 2 user verified (khác giới) + admin đề xuất match -> OFFERED.
 *   - dating: như offered + cả hai đồng ý -> DATING + hội thoại mở.
 *   - date-confirmed: như dating + user A đề xuất lịch tại quán đang hoạt động + B xác nhận.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createDatabase,
  DrizzleUnitOfWork,
  HmacBlindIndexer,
  LocalKeyEncryptor,
  parseMasterKeyRing,
} from '@tamgiao/db';
import { SystemClock } from '@tamgiao/kernel';
import { ConsoleSmsSender, createIdentityModule } from '@tamgiao/module-identity';
import { totpSecretFromUri } from '../../tests/e2e/src/lib/crypto.js';
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
  waitActive,
  waitConversation,
  type AdminSession,
  type FlowConfig,
  type UserSession,
  type UserSpec,
} from '../../tests/e2e/src/lib/flow.js';
import { ApiClient, HttpError, problemCode } from '../../tests/e2e/src/lib/http.js';
import { otpSourceFromEnv, type OtpSource } from '../../tests/e2e/src/lib/otp.js';

export const SCENARIOS = ['onboarded', 'verified', 'offered', 'dating', 'date-confirmed'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface AccountSummary {
  readonly phone: string;
  readonly userId: string;
  readonly status: string;
  readonly role?: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
}

export interface AdminSummary {
  readonly email: string;
  readonly password?: string | undefined;
  readonly totpSecret?: string;
  readonly otpauthUri?: string;
  readonly token?: string;
}

export interface SummaryData {
  readonly scenario: Scenario;
  readonly accounts: readonly AccountSummary[];
  readonly admin: AdminSummary;
}

/** Tách kịch bản từ argv. Ném ngoại lệ kèm danh sách kịch bản hợp lệ nếu không đúng. */
export function parseScenario(argv: readonly string[]): Scenario {
  let args = argv;
  if (
    args.length >= 2 &&
    (args[0]?.endsWith('node') || args[0]?.endsWith('node.exe') || args[1]?.includes('seed-fe'))
  ) {
    args = args.slice(2);
  }
  const candidate = args.find((arg) => !arg.startsWith('-'));
  if (candidate !== undefined && (SCENARIOS as readonly string[]).includes(candidate)) {
    return candidate as Scenario;
  }
  throw new Error(
    `Kịch bản không hợp lệ: "${candidate ?? ''}". Danh sách kịch bản hợp lệ: ${SCENARIOS.join(', ')}`,
  );
}

/** Dựng bảng kết quả in ra màn hình mà KHÔNG in token truy cập (bảo mật AGENTS.md mục 5). */
export function formatSummary(data: SummaryData): string {
  const lines: string[] = [];
  lines.push(`\n=== KẾT QUẢ SEED FE [${data.scenario}] ===\n`);
  lines.push('Tài khoản người dùng:');
  lines.push('| SĐT | User ID | Trạng thái |');
  lines.push('|---|---|---|');
  for (const acc of data.accounts) {
    lines.push(`| ${acc.phone} | ${acc.userId} | ${acc.status} |`);
  }
  lines.push('\nTài khoản Admin Dev:');
  lines.push(`- Email: ${data.admin.email}`);
  if (data.admin.password !== undefined) {
    lines.push(`- Mật khẩu: ${data.admin.password}`);
  }
  if (data.admin.totpSecret !== undefined) {
    lines.push(`- TOTP Secret: ${data.admin.totpSecret}`);
  }
  if (data.admin.otpauthUri !== undefined) {
    lines.push(`- TOTP URI: ${data.admin.otpauthUri}`);
  }
  lines.push('\nHướng dẫn: OTP xem ở log api (dòng [sms:dev])\n');
  return lines.join('\n');
}

/** Lấy nguồn OTP từ env hoặc tự dò tìm file log api local (.run/api.log). */
function getOtpSource(env: NodeJS.ProcessEnv): OtpSource {
  if (env.E2E_OTP_LOG_FILE || env.E2E_OTP_COMMAND || env.OTP_LOG_FILE || env.OTP_COMMAND) {
    return otpSourceFromEnv({
      ...env,
      E2E_OTP_LOG_FILE: env.E2E_OTP_LOG_FILE ?? env.OTP_LOG_FILE,
      E2E_OTP_COMMAND: env.E2E_OTP_COMMAND ?? env.OTP_COMMAND,
    });
  }
  const candidates = [
    resolve(process.cwd(), '.run/api.log'),
    resolve(process.cwd(), '../.run/api.log'),
    resolve(process.cwd(), 'tests/e2e/.run/api.log'),
    resolve(process.cwd(), '../tests/e2e/.run/api.log'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return () => readFile(candidate, 'utf8');
    }
  }
  return otpSourceFromEnv(env);
}

interface EnsuredAdmin {
  readonly email: string;
  readonly password?: string;
  readonly totpSecret: string;
  readonly otpauthUri: string;
  readonly session: AdminSession;
}

const TOTP_STEP_SECONDS = 30;

/** Chờ tới khi bước TOTP hiện tại lớn hơn bước đã dùng gần nhất (tối đa một cửa sổ 30s). */
export async function waitForFreshTotpStep(
  lastUsedStep: number | null,
  now: () => number = Date.now,
): Promise<void> {
  if (lastUsedStep === null) return;
  const currentStep = Math.floor(now() / 1000 / TOTP_STEP_SECONDS);
  if (currentStep > lastUsedStep) return;
  const nextStepAtMs = (lastUsedStep + 1) * TOTP_STEP_SECONDS * 1000;
  const waitMs = Math.max(0, nextStepAtMs - now()) + 500;
  console.info(`Chờ ${Math.ceil(waitMs / 1000)}s sang mã TOTP mới (mã hiện tại vừa được dùng)...`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

/** Đảm bảo có tài khoản chuyên viên admin trong DB và đăng nhập qua API. */
async function ensureAdminUser(api: ApiClient, env: NodeJS.ProcessEnv): Promise<EnsuredAdmin> {
  const email = env.SEED_ADMIN_EMAIL ?? env.E2E_ADMIN_EMAIL ?? 'dev-admin@tamgiao.test';
  const password = env.SEED_ADMIN_PASSWORD ?? env.E2E_ADMIN_PASSWORD ?? 'DevAdmin@123456';
  const providedTotpSecret = env.SEED_ADMIN_TOTP_SECRET ?? env.E2E_ADMIN_TOTP_SECRET;

  if (providedTotpSecret) {
    try {
      const session = await adminLogin(api, { email, password, totpSecret: providedTotpSecret });
      return {
        email,
        password,
        totpSecret: providedTotpSecret,
        otpauthUri: `otpauth://totp/T%C3%A2m%20Giao:${encodeURIComponent(email)}?secret=${providedTotpSecret}&issuer=T%C3%A2m%20Giao`,
        session,
      };
    } catch {
      // Tiếp tục fallback sang kết nối DB nếu đăng nhập bằng env không thành công
    }
  }

  const databaseUrl = env.DATABASE_URL ?? 'postgres://tamgiao@localhost:5433/tamgiao';
  const masterKeys = env.DATA_MASTER_KEYS ?? '1:dGFtZ2lhby1sb2NhbC1kZXYtbWFzdGVyLWtleS0wMDE=';
  const masterKeyVersion = Number(env.DATA_MASTER_KEY_VERSION ?? 1);
  const blindIndexKey = Buffer.from(
    env.BLIND_INDEX_KEY ?? 'dGFtZ2lhby1sb2NhbC1kZXYtYmxpbmQtaW5kZXgtMDE=',
    'base64',
  );
  const authSecret = Buffer.from(env.AUTH_SECRET ?? 'dGFtZ2lhby1sb2NhbC1kZXYtYXV0aC1zZWNyZXQtMDE=', 'base64');

  const database = createDatabase(databaseUrl, { maxConnections: 1 });
  try {
    const encryptor = new LocalKeyEncryptor(parseMasterKeyRing(masterKeys, masterKeyVersion));
    const blindIndexer = new HmacBlindIndexer(blindIndexKey);
    const uow = new DrizzleUnitOfWork(database.pool);
    const clock = new SystemClock();
    const identity = createIdentityModule({
      uow,
      clock,
      encryptor,
      blindIndexer,
      smsSender: new ConsoleSmsSender(),
      authSecret,
    });

    const created = await identity.commands.createAdminUser.execute({
      email,
      password,
      role: 'ADMIN',
    });

    let totpSecret: string;
    let otpauthUri: string;
    if (created.isOk()) {
      otpauthUri = created.value.otpauthUri;
      totpSecret = totpSecretFromUri(otpauthUri) ?? '';
    } else if (created.error.code === 'ADMIN_EMAIL_TAKEN') {
      const res = await database.pool.query<{
        id: string;
        totp_secret_enc: Uint8Array;
        last_totp_step: string | null;
      }>('SELECT id, totp_secret_enc, last_totp_step FROM identity.admin_users WHERE email = $1', [
        email.trim().toLowerCase(),
      ]);
      if (!res.rows[0]) {
        throw new Error(`Không tìm thấy admin ${email} trong DB`);
      }
      const row = res.rows[0];
      totpSecret = await encryptor.decrypt(row.totp_secret_enc, `identity.admin_users.totp_secret:${row.id}`);
      otpauthUri = `otpauth://totp/T%C3%A2m%20Giao:${encodeURIComponent(email)}?secret=${totpSecret}&issuer=T%C3%A2m%20Giao`;

      // BE chặn dùng lại mã TOTP (bước <= bước đã dùng): chạy seed liên tiếp trong cùng cửa sổ 30s → chờ sang bước kế.
      await waitForFreshTotpStep(row.last_totp_step === null ? null : Number(row.last_totp_step));

      // Mở khoá nếu tài khoản bị khoá do đăng nhập sai trước đó
      await database.pool.query(
        'UPDATE identity.admin_users SET failed_logins = 0, locked_until = NULL WHERE email = $1',
        [email.trim().toLowerCase()],
      );
    } else {
      throw new Error(`Không tạo được admin: ${created.error.code}`);
    }

    const session = await adminLogin(api, { email, password, totpSecret });
    return {
      email,
      password,
      totpSecret,
      otpauthUri,
      session,
    };
  } finally {
    await database.close();
  }
}

/** Chạy kịch bản được chọn và in kết quả. */
export async function runSeed(
  scenario: Scenario,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SummaryData> {
  const baseUrl = env.API_URL ?? env.E2E_BASE_URL ?? 'http://localhost:3000';
  const api = new ApiClient(baseUrl);
  const config: FlowConfig = {
    api,
    otp: getOtpSource(env),
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET ?? env.E2E_WEBHOOK_SECRET,
    paymentGateway: env.PAYMENT_GATEWAY ?? env.E2E_PAYMENT_GATEWAY ?? 'fake',
    eventTimeoutMs: Number(env.E2E_EVENT_TIMEOUT_MS ?? 30_000),
  };

  const tag = runTag();
  const createSpec = (gender: 'male' | 'female', prefix: string): UserSpec => ({
    gender,
    fullName: `${prefix} ${tag}`,
    phone: randomPhone(),
    // IP giả riêng mỗi user (API dev chạy TRUST_PROXY=true) → không vướng hạn mức OTP theo IP.
    forwardedFor: fakeIp(1_000 + Math.floor(Math.random() * 100_000)),
  });

  const admin = await ensureAdminUser(api, env);
  const adminSummary: AdminSummary = {
    email: admin.email,
    password: admin.password,
    totpSecret: admin.totpSecret,
    otpauthUri: admin.otpauthUri,
    token: admin.session.token,
  };

  switch (scenario) {
    case 'onboarded': {
      const [user] = (await registerUsers(config, [createSpec('male', 'FE Nam')])) as [UserSession];
      await completeProfile(user);
      return {
        scenario,
        accounts: [
          {
            phone: user.spec.phone,
            userId: user.userId,
            status: 'ONBOARDED',
            accessToken: user.accessToken,
            refreshToken: user.refreshToken,
          },
        ],
        admin: adminSummary,
      };
    }

    case 'verified': {
      const [user] = (await registerUsers(config, [createSpec('male', 'FE Nam')])) as [UserSession];
      await completeProfile(user);
      await payVerification(config, user);
      await submitKyc(user);
      await approveKyc(admin.session, user);
      await waitActive(config, user);
      return {
        scenario,
        accounts: [
          {
            phone: user.spec.phone,
            userId: user.userId,
            status: 'ACTIVE',
            accessToken: user.accessToken,
            refreshToken: user.refreshToken,
          },
        ],
        admin: adminSummary,
      };
    }

    case 'offered': {
      const [a, b] = (await registerUsers(config, [
        createSpec('male', 'FE Nam'),
        createSpec('female', 'FE Nu'),
      ])) as [UserSession, UserSession];
      await Promise.all([completeProfile(a), completeProfile(b)]);
      await Promise.all([payVerification(config, a), payVerification(config, b)]);
      await Promise.all([submitKyc(a), submitKyc(b)]);
      await approveKyc(admin.session, a);
      await approveKyc(admin.session, b);
      await Promise.all([waitActive(config, a), waitActive(config, b)]);
      await proposeMatch(config, admin.session, a, b);

      return {
        scenario,
        accounts: [
          {
            phone: a.spec.phone,
            userId: a.userId,
            status: 'OFFERED',
            accessToken: a.accessToken,
            refreshToken: a.refreshToken,
          },
          {
            phone: b.spec.phone,
            userId: b.userId,
            status: 'OFFERED',
            accessToken: b.accessToken,
            refreshToken: b.refreshToken,
          },
        ],
        admin: adminSummary,
      };
    }

    case 'dating': {
      const [a, b] = (await registerUsers(config, [
        createSpec('male', 'FE Nam'),
        createSpec('female', 'FE Nu'),
      ])) as [UserSession, UserSession];
      await Promise.all([completeProfile(a), completeProfile(b)]);
      await Promise.all([payVerification(config, a), payVerification(config, b)]);
      await Promise.all([submitKyc(a), submitKyc(b)]);
      await approveKyc(admin.session, a);
      await approveKyc(admin.session, b);
      await Promise.all([waitActive(config, a), waitActive(config, b)]);
      await proposeMatch(config, admin.session, a, b);
      await acceptBoth(a, b);
      await waitConversation(config, a, b.userId);

      return {
        scenario,
        accounts: [
          {
            phone: a.spec.phone,
            userId: a.userId,
            status: 'DATING',
            accessToken: a.accessToken,
            refreshToken: a.refreshToken,
          },
          {
            phone: b.spec.phone,
            userId: b.userId,
            status: 'DATING',
            accessToken: b.accessToken,
            refreshToken: b.refreshToken,
          },
        ],
        admin: adminSummary,
      };
    }

    case 'date-confirmed': {
      const [a, b] = (await registerUsers(config, [
        createSpec('male', 'FE Nam'),
        createSpec('female', 'FE Nu'),
      ])) as [UserSession, UserSession];
      await Promise.all([completeProfile(a), completeProfile(b)]);
      await Promise.all([payVerification(config, a), payVerification(config, b)]);
      await Promise.all([submitKyc(a), submitKyc(b)]);
      await approveKyc(admin.session, a);
      await approveKyc(admin.session, b);
      await Promise.all([waitActive(config, a), waitActive(config, b)]);
      await proposeMatch(config, admin.session, a, b);
      await acceptBoth(a, b);
      await waitConversation(config, a, b.userId);

      // Tìm quán đang hoạt động hoặc tạo mới bằng API admin nếu chưa có
      let partnerId: string | undefined;
      try {
        const partners = await a.http.get<{ items: readonly { id: string; name: string }[] }>('/partners', {
          token: a.accessToken,
        });
        if (partners.items.length > 0 && partners.items[0]?.id) {
          partnerId = partners.items[0].id;
        }
      } catch {
        // Bỏ qua nếu chưa có quán
      }

      if (!partnerId) {
        const createdPartner = await api.post<{ id: string }>(
          '/admin/partners',
          { name: `Quán Cà Phê Dev ${tag}`, address: '123 Phố Huế, Hà Nội', tags: ['cafe', 'dev'] },
          { token: admin.session.token, expect: 201 },
        );
        partnerId = createdPartner.id;
      }

      const startsAt = new Date(Date.now() + 24 * 3_600_000);
      const endsAt = new Date(startsAt.getTime() + 2 * 3_600_000);
      const plan = await a.http.post<{ id: string }>(
        '/me/dates',
        {
          partnerId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
        { token: a.accessToken, expect: 201 },
      );
      await b.http.post(`/me/dates/${plan.id}/confirm`, {}, { token: b.accessToken });

      return {
        scenario,
        accounts: [
          {
            phone: a.spec.phone,
            userId: a.userId,
            status: 'DATE_CONFIRMED',
            accessToken: a.accessToken,
            refreshToken: a.refreshToken,
          },
          {
            phone: b.spec.phone,
            userId: b.userId,
            status: 'DATE_CONFIRMED',
            accessToken: b.accessToken,
            refreshToken: b.refreshToken,
          },
        ],
        admin: adminSummary,
      };
    }
  }
}

async function main(): Promise<void> {
  let scenario: Scenario;
  try {
    scenario = parseScenario(process.argv);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }

  try {
    const summary = await runSeed(scenario, process.env);
    console.info(formatSummary(summary));
    process.exit(0);
  } catch (error) {
    if (error instanceof HttpError) {
      const code = problemCode(error.body);
      console.error(`Lỗi API: ${error.method} ${error.path} -> ${error.status} ${code || error.message}`);
      if (code) {
        console.error(`Mã lỗi (problem code): ${code}`);
      }
    } else {
      console.error(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
