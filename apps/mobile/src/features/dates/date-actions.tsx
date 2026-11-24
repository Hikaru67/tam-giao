import { Fragment, type ReactNode } from 'react';
import type { DatePlanDto } from '@tamgiao/contracts/dating';
import type { DateView } from './date-view.js';
import { VoucherEntry } from '../vouchers/voucher-entry.js';

/** Thao tác dưới thẻ lịch hẹn. Mỗi task sau (voucher, check-in, đánh giá) thêm khối của mình ở đây. */
export function renderDateActions(plan: DatePlanDto, view: DateView): ReactNode {
  return (
    <Fragment>
      <VoucherEntry plan={plan} view={view} />
    </Fragment>
  );
}
