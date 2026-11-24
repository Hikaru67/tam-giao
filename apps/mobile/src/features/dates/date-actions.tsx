import type { ReactNode } from 'react';
import type { DatePlanDto } from '@tamgiao/contracts/dating';
import { VoucherEntry } from '../vouchers/voucher-entry.js';
import { CheckInCard } from './check-in/index.js';
import type { DateView } from './date-view.js';

/** Thao tác dưới thẻ lịch hẹn: check-in, voucher, đánh giá. Mỗi khối tự quyết định có hiện hay không. */
export function renderDateActions(plan: DatePlanDto, view: DateView): ReactNode {
  return (
    <>
      <CheckInCard plan={plan} view={view} />
      <VoucherEntry plan={plan} view={view} />
    </>
  );
}
