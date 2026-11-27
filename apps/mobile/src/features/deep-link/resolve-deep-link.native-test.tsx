import { redirectSystemPath } from '../../../app/+native-intent';
import { DEEP_LINK_FALLBACK, isUuid, resolveDeepLink } from './resolve-deep-link.js';

const SAMPLE_UUID_LOWER = '01952e46-953b-789a-b283-a9d701897d26';
const SAMPLE_UUID_UPPER = '01952E46-953B-789A-B283-A9D701897D26';

describe('resolveDeepLink & +native-intent (FE-S6-03)', () => {
  it.each([
    [`tamgiao://chat/${SAMPLE_UUID_LOWER}`, `/chat/${SAMPLE_UUID_LOWER}`],
    [`tamgiao:///chat/${SAMPLE_UUID_UPPER}`, `/chat/${SAMPLE_UUID_LOWER}`],
    [`tamgiao://dates/${SAMPLE_UUID_LOWER}`, `/dates/${SAMPLE_UUID_LOWER}`],
    [
      `tamgiao://dates/feedback?datePlanId=${SAMPLE_UUID_LOWER}`,
      `/dates/feedback?datePlanId=${SAMPLE_UUID_LOWER}`,
    ],
    ['tamgiao://payments/return?orderCode=123&status=PAID', '/payments/return'],
    ['tamgiao://match/profile', '/match/profile'],
    ['/settings/notifications', '/settings/notifications'],
    ['exp://192.168.1.5:8081/--/inbox', '/inbox'],
    ['tamgiao://', '/'],
  ])('link hợp lệ: %s → %s', (rawUrl, expected) => {
    expect(resolveDeepLink(rawUrl)).toBe(expected);
  });

  it.each([
    ['tamgiao://kyc'],
    ['tamgiao://settings/account'],
    ['tamgiao://(main)/home'],
    ['tamgiao://admin'],
    ['tamgiao://chat/123'],
    ['tamgiao://chat/../../kyc'],
    [`tamgiao://chat/${SAMPLE_UUID_LOWER}/extra`],
    ['tamgiao://dates/feedback'],
    ['tamgiao://dates/feedback?datePlanId=abc'],
    [`https://evil.example/chat/${SAMPLE_UUID_LOWER}`],
    ['javascript:alert(1)'],
    [`exp://host:8081/chat/${SAMPLE_UUID_LOWER}`],
    [''],
    ['%2e%2e/kyc'],
  ])('link bị từ chối: %s → /', (rawUrl) => {
    expect(resolveDeepLink(rawUrl)).toBe(DEEP_LINK_FALLBACK);
  });

  it('redirectSystemPath trong +native-intent.tsx trả đúng kết quả cho link hợp lệ và không hợp lệ', () => {
    expect(
      redirectSystemPath({
        path: `tamgiao://chat/${SAMPLE_UUID_UPPER}`,
        initial: true,
      }),
    ).toBe(`/chat/${SAMPLE_UUID_LOWER}`);

    expect(
      redirectSystemPath({
        path: 'https://evil.example/kyc',
        initial: false,
      }),
    ).toBe(DEEP_LINK_FALLBACK);
  });

  it('isUuid kiểm tra đúng UUID hợp lệ và từ chối giá trị sai', () => {
    expect(isUuid(SAMPLE_UUID_LOWER)).toBe(true);
    expect(isUuid(SAMPLE_UUID_UPPER)).toBe(true);
    expect(isUuid(123)).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
