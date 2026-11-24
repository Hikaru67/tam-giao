import { Redirect } from 'expo-router';
import { VOUCHERS_ENABLED, VouchersScreen } from '../../../src/features/vouchers/index.js';

export default function VouchersRoute() {
  if (!VOUCHERS_ENABLED) {
    return <Redirect href="/(main)/home" />;
  }
  return <VouchersScreen />;
}
