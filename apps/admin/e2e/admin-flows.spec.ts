import { expect, test, type Page } from '@playwright/test';
import { ApiClient, waitFor } from '../../../tests/e2e/src/lib/http.js';
import { LOGIN_COPY } from '../src/features/auth/copy';
import { KYC_COPY } from '../src/features/kyc/copy';
import { MATCHING_COPY } from '../src/features/matching/copy';
import { MODERATION_COPY } from '../src/features/moderation/copy';
import { NAV_COPY, SHELL_COPY } from '../src/layout/copy';
import { API_BASE_URL, loadAdminCredentials } from './support/env';
import {
  ADMIN_SEED_FILE,
  readSeed,
  seedFor,
  type AdminProjectSeed,
  type AdminSeed,
} from './support/seed-store';
import { nextTotpCode } from './support/totp-gate';

const KYC_STEPS = ['CCCD_CHIP', 'MARITAL_STATUS', 'MANUAL_REVIEW', 'INTERVIEW'] as const;

test.describe.configure({ mode: 'serial' });

test.describe('admin: TOTP login → eKYC → match → report', () => {
  let sharedPage: Page | undefined;
  let projectSeed: AdminProjectSeed | undefined;

  function getTestContext(): { readonly page: Page; readonly seed: AdminProjectSeed } {
    if (!sharedPage || !projectSeed) {
      throw new Error('Phiên trình duyệt hoặc dữ liệu seed chưa được khởi tạo trong beforeAll.');
    }
    return { page: sharedPage, seed: projectSeed };
  }

  test.beforeAll(async ({ browser }, testInfo) => {
    projectSeed = seedFor(readSeed<AdminSeed>(ADMIN_SEED_FILE), testInfo.project.name);
    sharedPage = await browser.newPage();
  });

  test.afterAll(async () => {
    await sharedPage?.close();
  });

  test('logs in with password + TOTP', async () => {
    const { page } = getTestContext();
    const creds = loadAdminCredentials();

    await page.goto('/login');
    await page.getByLabel(LOGIN_COPY.emailLabel).fill(creds.email);
    await page.getByLabel(LOGIN_COPY.passwordLabel, { exact: true }).fill(creds.password);

    // Sinh mã ngay trước khi điền để giữ tối đa thời gian hiệu lực của cửa sổ 30s.
    const totpCode = await nextTotpCode(creds.totpSecret);
    await page.getByLabel(LOGIN_COPY.totpLabel).fill(totpCode);
    await page.getByRole('button', { name: LOGIN_COPY.submit }).click();

    const nav = page.getByRole('navigation', { name: SHELL_COPY.navLabel });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: NAV_COPY.kyc })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login(?:$|\?)/);
  });

  test('approves a submitted eKYC', async () => {
    const { page, seed } = getTestContext();
    const nav = page.getByRole('navigation', { name: SHELL_COPY.navLabel });
    await nav.getByRole('link', { name: NAV_COPY.kyc }).click();

    await page.getByLabel(KYC_COPY.queue.searchLabel).fill(seed.kycUser.fullName);
    await page.getByRole('button', { name: KYC_COPY.queue.searchSubmit, exact: true }).click();

    const queueList = page.getByRole('list', { name: KYC_COPY.queue.label });
    await queueList.getByRole('link', { name: seed.kycUser.fullName }).click();

    await page.getByRole('button', { name: KYC_COPY.decisions.assign }).click();
    await expect(
      page.getByRole('status').filter({ hasText: KYC_COPY.decisions.success.assign }),
    ).toBeVisible();

    for (const step of KYC_STEPS) {
      const passName = `${KYC_COPY.detail.stepPass}: ${KYC_COPY.steps[step]}`;
      const stepItem = page.locator('li').filter({
        has: page.getByRole('button', { name: passName, exact: true }),
      });
      await stepItem.getByRole('button', { name: passName, exact: true }).click();
      // Đợi bước hiện tại đổi khỏi PENDING và hiển thị thông báo thành công trước khi bấm bước kế.
      await expect(stepItem.getByText(KYC_COPY.stepStatus.PENDING, { exact: true })).toBeHidden();
      await expect(
        page.getByRole('status').filter({ hasText: KYC_COPY.decisions.success.markStep }),
      ).toBeVisible();
    }

    const approveButton = page.getByRole('button', { name: KYC_COPY.decisions.approve });
    await expect(approveButton).toBeEnabled();
    await approveButton.click();

    await expect(
      page.getByRole('status').filter({ hasText: KYC_COPY.decisions.success.approve }),
    ).toBeVisible();
    const detailHeader = page.getByRole('heading', { level: 2, name: seed.kycUser.fullName }).locator('..');
    await expect(detailHeader.getByText(KYC_COPY.status.APPROVED, { exact: true })).toBeVisible();

    const api = new ApiClient(API_BASE_URL);
    await waitFor('kycUser onboardingStep ACTIVE', async () => {
      const me = await api.get<{ onboardingStep: string }>('/me', {
        token: seed.kycUser.accessToken,
      });
      return me.onboardingStep === 'ACTIVE' ? true : undefined;
    });
  });

  test('proposes a match between two verified users', async () => {
    const { page, seed } = getTestContext();
    await page.goto('/matching/propose');

    await page.getByLabel(MATCHING_COPY.propose.searchLabel).fill(seed.matchUserA.fullName);
    await page.getByRole('button', { name: MATCHING_COPY.propose.searchSubmit, exact: true }).click();

    const userARow = page.getByText(seed.matchUserA.fullName, { exact: true }).locator('../..');
    await userARow.getByRole('button', { name: MATCHING_COPY.propose.selectButton, exact: true }).click();

    const candidateGroup = page.getByRole('radiogroup', { name: MATCHING_COPY.propose.candidatesSection });
    await candidateGroup.getByRole('radio', { name: seed.matchUserB.fullName }).check();

    await expect(page.getByRole('heading', { name: MATCHING_COPY.propose.comparisonSection })).toBeVisible();
    await page.getByLabel(MATCHING_COPY.propose.staffNoteLabel).fill('E2E FE-S6-02');
    await page.getByRole('button', { name: MATCHING_COPY.propose.submitButton, exact: true }).click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog
      .getByRole('button', { name: MATCHING_COPY.propose.confirmSubmit, exact: true })
      .click();

    await expect(
      page.getByRole('status').filter({ hasText: MATCHING_COPY.propose.successToast }),
    ).toBeVisible();

    const api = new ApiClient(API_BASE_URL);
    const matchView = await api.get<{ match: { status: string } | null }>('/me/match', {
      token: seed.matchUserA.accessToken,
    });
    expect(matchView.match?.status).toBe('OFFERED');
  });

  test('resolves a violation report', async () => {
    const { page, seed } = getTestContext();
    await page.goto(`/moderation/reports/${seed.reportId}`);

    await page.getByRole('button', { name: MODERATION_COPY.detail.actions.startReview, exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: MODERATION_COPY.detail.toasts.startReviewSuccess }),
    ).toBeVisible();

    await page.getByRole('button', { name: MODERATION_COPY.detail.actions.resolve, exact: true }).click();

    const resolveDialog = page.getByRole('dialog');
    await expect(resolveDialog).toBeVisible();
    await resolveDialog
      .getByLabel(MODERATION_COPY.resolveDialog.conclusionLabel)
      .fill('Xác nhận vi phạm qua kiểm thử E2E.');
    await resolveDialog
      .getByRole('button', { name: MODERATION_COPY.resolveDialog.submitResolve, exact: true })
      .click();

    await expect(
      page.getByRole('alert').filter({ hasText: MODERATION_COPY.detail.toasts.resolveSuccess }),
    ).toBeVisible();
    const detailHeader = page
      .getByRole('heading', { level: 2, name: MODERATION_COPY.categories.HARASSMENT })
      .locator('..');
    await expect(detailHeader.getByText(MODERATION_COPY.statuses.RESOLVED, { exact: true })).toBeVisible();
  });
});
