import { useRouter } from 'expo-router';
import { Button } from '@tamgiao/ui-mobile';
import type { DatePlanDto } from '@tamgiao/contracts/dating';
import type { DateView } from '../dates/date-view.js';
import { useMyVouchers } from '../kyc/use-verification-status.js';
import { VOUCHERS_COPY } from './copy.js';
import { VOUCHERS_ENABLED } from './feature-flag.js';

export interface VoucherEntryProps {
  readonly plan: DatePlanDto;
  readonly view: DateView;
}

export function VoucherEntry({ plan, view }: VoucherEntryProps) {
  const router = useRouter();
  const vouchersQuery = useMyVouchers();

  if (!VOUCHERS_ENABLED) {
    return null;
  }

  const isEligibleView = view.kind === 'confirmed' || view.kind === 'in_progress';
  const isInviter = plan.myRole === 'INVITER';
  const hasActiveVoucher = vouchersQuery.data?.items.some((v) => v.status === 'ACTIVE') ?? false;

  if (!isEligibleView || !isInviter || !hasActiveVoucher) {
    return null;
  }

  return (
    <Button
      testID="date-voucher"
      variant="secondary"
      size="md"
      fullWidth
      onPress={() => {
        router.push('/(main)/vouchers');
      }}
    >
      {VOUCHERS_COPY.actions.entryButton}
    </Button>
  );
}
