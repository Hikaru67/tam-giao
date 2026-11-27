import {
  acceptBoth,
  proposeMatch,
  registerUsers,
  runTag,
  waitConversation,
  type AdminSession,
  type FlowConfig,
} from '../../../tests/e2e/src/lib/flow.js';
import { waitFor } from '../../../tests/e2e/src/lib/http.js';
import { BROWSER_PROJECTS, createFlowConfig, loadAdminCredentials } from '../../admin/e2e/support/env';
import { writeSeed } from '../../admin/e2e/support/seed-store';
import { adminApiLogin } from '../../admin/e2e/support/totp-gate';
import { toSeeded, userSpec, verifyUsers } from '../../admin/e2e/support/users';
import { PARTNER_SEED_FILE, type PartnerProjectSeed, type PartnerSeed } from './partner-seed';

const STAFF_PIN = '246810';

async function seedProject(
  config: FlowConfig,
  admin: AdminSession,
  project: string,
  tag: string,
): Promise<readonly [string, PartnerProjectSeed]> {
  const partnerName = `Quán E2E ${project} ${tag}`;
  const partner = await admin.http.post<{ id: string }>(
    '/admin/partners',
    { name: partnerName, address: '1 Tràng Tiền, Hà Nội', tags: ['e2e'] },
    { token: admin.token, expect: 201 },
  );

  // Không gửi deviceId để nhân viên tự gắn vào thiết bị ở lần đăng nhập đầu tiên trên trình duyệt.
  const staff = await admin.http.post<{ id: string }>(
    `/admin/partners/${partner.id}/staff`,
    { name: `Nhân viên E2E ${project}`, pin: STAFF_PIN },
    { token: admin.token, expect: 201 },
  );

  const registered = await registerUsers(config, [
    userSpec('male', `E2E ${project} ${tag} Nam V`),
    userSpec('female', `E2E ${project} ${tag} Nu V`),
  ]);
  const [userA, userB] = registered;
  if (!userA || !userB) {
    throw new Error(`Số lượng tài khoản đăng ký cho project "${project}" không đủ 2.`);
  }

  await verifyUsers(config, admin, [userA, userB]);
  await proposeMatch(config, admin, userA, userB);
  await acceptBoth(userA, userB);
  await waitConversation(config, userA, userB.userId);

  const startsAt = new Date(Date.now() + 24 * 3_600_000);
  const endsAt = new Date(startsAt.getTime() + 2 * 3_600_000);
  const plan = await userA.http.post<{ id: string }>(
    '/me/dates',
    {
      partnerId: partner.id,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
    { token: userA.accessToken, expect: 201 },
  );
  await userB.http.post(`/me/dates/${plan.id}/confirm`, {}, { token: userB.accessToken });

  const { value: voucher } = await waitFor(
    `voucher ACTIVE (${project})`,
    async () => {
      const list = await userA.http.get<{
        items: readonly { readonly id: string; readonly status: string; readonly valueVnd: number }[];
      }>('/me/vouchers', { token: userA.accessToken });
      return list.items.find((item) => item.status === 'ACTIVE');
    },
    { timeoutMs: config.eventTimeoutMs },
  );

  return [
    project,
    {
      partnerName,
      staffId: staff.id,
      staffPin: STAFF_PIN,
      voucherId: voucher.id,
      voucherValueVnd: voucher.valueVnd,
      voucherOwner: toSeeded(userA),
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
  const seed: PartnerSeed = Object.fromEntries(entries);
  writeSeed(PARTNER_SEED_FILE, seed);
}
