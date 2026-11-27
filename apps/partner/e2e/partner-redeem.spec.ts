import { expect, test, type Locator, type Page } from '@playwright/test';
import { ApiClient } from '../../../tests/e2e/src/lib/http.js';
import { API_BASE_URL } from '../../admin/e2e/support/env';
import { readSeed, seedFor } from '../../admin/e2e/support/seed-store';
import { LOGIN_COPY, SCAN_COPY } from '../src/features/auth/copy';
import { PARTNER_SEED_FILE, type PartnerSeed } from './partner-seed';

async function openManualForm(page: Page): Promise<Locator> {
  const tokenField = page.getByLabel(SCAN_COPY.manualInput.tokenLabel);
  const openManual = page.getByRole('button', { name: SCAN_COPY.scanner.openManualInput });

  await expect(tokenField.or(openManual)).toBeVisible();
  if (!(await tokenField.isVisible())) {
    // Camera headless có thể chuyển sang denied/unavailable ngay lúc bấm làm nút biến mất và form tự mở.
    await openManual.click({ timeout: 3_000 }).catch(async (error: unknown) => {
      if (!(await tokenField.isVisible())) throw error;
    });
  }
  await expect(tokenField).toBeVisible();
  return tokenField;
}

test('staff logs in with PIN and redeems a voucher by manual code', async ({ page }, testInfo) => {
  const seed = seedFor(readSeed<PartnerSeed>(PARTNER_SEED_FILE), testInfo.project.name);

  await page.goto('/login');
  await page.getByLabel(LOGIN_COPY.staffIdLabel).fill(seed.staffId);
  await page.getByLabel(LOGIN_COPY.pinLabel).fill(seed.staffPin);
  await page.getByRole('button', { name: LOGIN_COPY.submit }).click();

  await expect(page.getByRole('banner').getByText(seed.partnerName, { exact: true })).toBeVisible();

  const tokenField = await openManualForm(page);

  const api = new ApiClient(API_BASE_URL);
  const { token: qrToken } = await api.get<{ token: string }>(`/me/vouchers/${seed.voucherId}/qr`, {
    token: seed.voucherOwner.accessToken,
  });

  await tokenField.fill(qrToken);
  await page.getByRole('button', { name: SCAN_COPY.manualInput.submit }).click();

  const successRegion = page.getByRole('region', { name: SCAN_COPY.outcomes.success.title });
  await expect(successRegion).toBeVisible();
  await expect(successRegion).toContainText(SCAN_COPY.formatVnd(seed.voucherValueVnd));

  await page.getByRole('button', { name: SCAN_COPY.actions.nextScan }).click();
  const nextTokenField = await openManualForm(page);
  await nextTokenField.fill(qrToken);
  await page.getByRole('button', { name: SCAN_COPY.manualInput.submit }).click();

  const alreadyRedeemedRegion = page.getByRole('region', {
    name: SCAN_COPY.outcomes.alreadyRedeemed.title,
  });
  await expect(alreadyRedeemedRegion).toBeVisible();
  await expect(
    alreadyRedeemedRegion.getByRole('heading', { name: SCAN_COPY.outcomes.alreadyRedeemed.title }),
  ).toBeVisible();

  const vouchers = await api.get<{
    items: readonly { readonly id: string; readonly status: string }[];
  }>('/me/vouchers', { token: seed.voucherOwner.accessToken });
  const redeemed = vouchers.items.find((item) => item.id === seed.voucherId);
  expect(redeemed?.status).toBe('REDEEMED');
});
