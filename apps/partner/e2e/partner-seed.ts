import { E2E_RUN_DIR } from '../../admin/e2e/support/env';
import type { SeededUser } from '../../admin/e2e/support/users';

export const PARTNER_SEED_FILE = `${E2E_RUN_DIR}/playwright/partner-seed.json`;

export interface PartnerProjectSeed {
  readonly partnerName: string;
  readonly staffId: string;
  readonly staffPin: string;
  readonly voucherId: string;
  readonly voucherValueVnd: number;
  readonly voucherOwner: SeededUser;
}

export type PartnerSeed = Readonly<Record<string, PartnerProjectSeed>>;
