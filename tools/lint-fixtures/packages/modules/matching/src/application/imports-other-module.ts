// Fixture cố ý vi phạm A3: import domain/infrastructure của module billing.
import { Voucher } from '@tamgiao/module-billing/domain/voucher';
import { vouchers } from '../../../billing/src/infrastructure/schema.js';

export const bad = [Voucher, vouchers];
