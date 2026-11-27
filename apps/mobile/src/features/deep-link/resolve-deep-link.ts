/**
 * Bộ xác thực và chuẩn hoá deep link trước khi giao cho expo-router (FE-S6-03).
 *
 * Lý do: liên kết từ bên ngoài (trình duyệt, app khác, thông báo) có thể trỏ tới route nội bộ tuỳ ý
 * (vd `tamgiao://kyc`, `tamgiao://(main)/home`, traversal `..`) hoặc truyền ID rác / query độc hại.
 * Chỉ những đường dẫn nằm trong allowlist bên dưới mới được điều hướng; mọi trường hợp khác rơi về
 * `DEEP_LINK_FALLBACK`. Các màn đích vẫn tự kiểm tra phiên đăng nhập qua `SessionGate`.
 *
 * Lưu ý bảo trì: khi thêm route deep-link mới vào app, cần bổ sung vào allowlist tại đây.
 */
export const DEEP_LINK_FALLBACK = '/';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEME_REGEX = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_SCHEMES = new Set(['tamgiao', 'exp', 'exps']);
const EXPO_DEV_SEPARATOR = '/--/';

const STATIC_ALLOWLIST = new Set([
  'home',
  'inbox',
  'match',
  'match/profile',
  'dates',
  'safety',
  'vouchers',
  'settings',
  'settings/notifications',
  'payments/return',
]);

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Trả đường dẫn nội bộ an toàn cho expo-router; mọi URL không thuộc allowlist → `DEEP_LINK_FALLBACK`.
 * Không bao giờ throw.
 */
export function resolveDeepLink(rawUrl: string): string {
  try {
    if (typeof rawUrl !== 'string') {
      return DEEP_LINK_FALLBACK;
    }

    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return DEEP_LINK_FALLBACK;
    }

    let scheme: string | null = null;
    let rest = trimmed;

    const schemeMatch = SCHEME_REGEX.exec(trimmed);
    if (schemeMatch) {
      const matchedScheme = schemeMatch[1];
      if (!matchedScheme) {
        return DEEP_LINK_FALLBACK;
      }
      scheme = matchedScheme.toLowerCase();
      if (!ALLOWED_SCHEMES.has(scheme)) {
        return DEEP_LINK_FALLBACK;
      }
      rest = trimmed.slice(schemeMatch[0].length);
    }

    const expoMarkerIndex = rest.indexOf(EXPO_DEV_SEPARATOR);
    let pathAndQuery: string;
    if (expoMarkerIndex !== -1) {
      pathAndQuery = rest.slice(expoMarkerIndex + EXPO_DEV_SEPARATOR.length);
    } else if (scheme === 'exp' || scheme === 'exps') {
      // URL Expo Go/dev bắt buộc có `/--/` ngăn cách host dev server với path của app.
      return DEEP_LINK_FALLBACK;
    } else {
      pathAndQuery = rest.replace(/^\/+/, '');
    }

    const hashIndex = pathAndQuery.indexOf('#');
    const withoutHash = hashIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, hashIndex);

    const queryIndex = withoutHash.indexOf('?');
    const rawPath = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
    const rawQuery = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1);

    const segments = rawPath.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      return DEEP_LINK_FALLBACK;
    }

    const joined = segments.join('/');
    if (STATIC_ALLOWLIST.has(joined)) {
      return `/${joined}`;
    }

    if (segments.length === 2) {
      const [first, second] = segments;
      if (first === 'chat' && isUuid(second)) {
        return `/chat/${second.toLowerCase()}`;
      }
      if (first === 'dates') {
        if (second === 'feedback') {
          const params = new URLSearchParams(rawQuery);
          const datePlanId = params.get('datePlanId');
          if (isUuid(datePlanId)) {
            return `/dates/feedback?datePlanId=${datePlanId.toLowerCase()}`;
          }
          return DEEP_LINK_FALLBACK;
        }
        if (isUuid(second)) {
          return `/dates/${second.toLowerCase()}`;
        }
      }
    }

    return DEEP_LINK_FALLBACK;
  } catch {
    return DEEP_LINK_FALLBACK;
  }
}
