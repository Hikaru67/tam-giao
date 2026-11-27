import {
  completeProfile,
  payVerification,
  proposeMatch,
  registerUsers,
  runTag,
  submitKyc,
  type AdminSession,
  type FlowConfig,
} from '../../../tests/e2e/src/lib/flow.js';
import { waitFor } from '../../../tests/e2e/src/lib/http.js';
import { BROWSER_PROJECTS, createFlowConfig, loadAdminCredentials } from './support/env';
import { ADMIN_SEED_FILE, writeSeed, type AdminProjectSeed, type AdminSeed } from './support/seed-store';
import { adminApiLogin } from './support/totp-gate';
import { toSeeded, userSpec, verifyUsers } from './support/users';

async function seedProject(
  config: FlowConfig,
  admin: AdminSession,
  project: string,
  tag: string,
): Promise<readonly [string, AdminProjectSeed]> {
  const registered = await registerUsers(config, [
    userSpec('male', `E2E ${project} ${tag} Kyc`),
    userSpec('male', `E2E ${project} ${tag} Nam A`),
    userSpec('female', `E2E ${project} ${tag} Nu B`),
    userSpec('male', `E2E ${project} ${tag} Nam R`),
    userSpec('female', `E2E ${project} ${tag} Nu R`),
  ]);

  const [kycUser, userA, userB, reporter, reported] = registered;
  if (!kycUser || !userA || !userB || !reporter || !reported) {
    throw new Error(`Số lượng tài khoản đăng ký cho project "${project}" không đủ 5.`);
  }

  await Promise.all([
    (async () => {
      await completeProfile(kycUser);
      await payVerification(config, kycUser);
      await submitKyc(kycUser);
    })(),
    verifyUsers(config, admin, [userA, userB, reporter, reported]),
  ]);

  // Chờ worker đồng bộ read model ứng viên để màn đề xuất ghép đôi thấy B trong danh sách của A.
  await waitFor(
    `candidates ${project}: A ⊇ B`,
    async () => {
      const res = await admin.http.get<{ items: { userId: string }[] }>(
        `/admin/users/${userA.userId}/candidates?limit=50`,
        { token: admin.token },
      );
      return res.items.some((item) => item.userId === userB.userId) ? true : undefined;
    },
    { timeoutMs: config.eventTimeoutMs, intervalMs: 1_000 },
  );

  await proposeMatch(config, admin, reporter, reported);
  const report = await reporter.http.post<{ reportId: string }>(
    '/me/reports',
    {
      reportedUserId: reported.userId,
      category: 'HARASSMENT',
      description: 'Báo cáo kiểm thử tự động (FE-S6-02).',
    },
    { token: reporter.accessToken, expect: 201 },
  );

  return [
    project,
    {
      kycUser: toSeeded(kycUser),
      matchUserA: toSeeded(userA),
      matchUserB: toSeeded(userB),
      reportId: report.reportId,
      reporter: toSeeded(reporter),
      reported: toSeeded(reported),
    },
  ] as const;
}

// eslint-disable-next-line import-x/no-default-export -- Playwright yêu cầu default export cho globalSetup
export default async function globalSetup(): Promise<void> {
  const config = createFlowConfig();
  const admin = await adminApiLogin(config.api, loadAdminCredentials());
  const tag = runTag();

  const entries = await Promise.all(
    BROWSER_PROJECTS.map((project) => seedProject(config, admin, project, tag)),
  );
  const seed: AdminSeed = Object.fromEntries(entries);
  writeSeed(ADMIN_SEED_FILE, seed);
}
