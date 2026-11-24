import type { ReactNode } from 'react';
import type { DatePlanDto } from '@tamgiao/contracts/dating';
import type { DateView } from './date-view.js';

/** Thao tác dưới thẻ lịch hẹn. Mỗi task sau (voucher, check-in, đánh giá) thêm khối của mình ở đây. */
export function renderDateActions(_plan: DatePlanDto, _view: DateView): ReactNode {
  return null;
}
