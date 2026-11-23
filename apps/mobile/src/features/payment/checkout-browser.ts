import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { PAYMENT_RETURN_PATH } from './constants.js';

/** Mở trang thanh toán của cổng trong phiên trình duyệt; resolve khi người dùng quay lại app (deep link) hoặc tự đóng trình duyệt. */
export async function openCheckout(checkoutUrl: string): Promise<void> {
  await WebBrowser.openAuthSessionAsync(checkoutUrl, Linking.createURL(PAYMENT_RETURN_PATH));
}
