export const REDACTED = '[REDACTED]';

/**
 * Khoá nhạy cảm (so khớp không phân biệt hoa thường, so sánh với key.toLowerCase()).
 * Bao gồm các khoá PII/secret từ BE và khoá bổ sung đặc thù FE (chat, push token, hồ sơ).
 */
export const SENSITIVE_KEYS: readonly string[] = [
  'phone',
  'phonenumber',
  'cccd',
  'cccdnumber',
  'idnumber',
  'otp',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'secretaccesskey',
  'income',
  'messagebody',
  'body',
  'content',
  'message',
  'text',
  'email',
  'code',
  'set-cookie',
  'access_token',
  'refresh_token',
  'id_token',
  'pushtoken',
  'expopushtoken',
  'devicetoken',
  'fullname',
  'address',
  'dob',
  'dateofbirth',
];

const SENSITIVE_KEY_SET = new Set<string>(SENSITIVE_KEYS);

/** Giá trị chuỗi dưới các khoá này được giữ nguyên để không làm hỏng mã truy vết kỹ thuật. */
const PRESERVED_KEY_SET = new Set<string>([
  'traceid',
  'trace_id',
  'span_id',
  'parent_span_id',
  'event_id',
  'funnel_step',
  'api_error_code',
  'api_status',
]);

const MAX_SCRUB_DEPTH = 10;

const UUID_SPLIT_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g;
const EXPO_PUSH_TOKEN_PATTERN = /Expo(?:nent)?PushToken\[[^\]]*\]/g;
const SENSITIVE_QUERY_PARAM_PATTERN =
  /([?&#](?:token|access_token|accessToken|refresh_token|refreshToken|id_token|code|otp|phone|email|cccd)=)[^&#\s]*/gi;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CCCD_PATTERN = /(^|\D)\d{12}(?!\d)/g;
const VN_PHONE_PATTERN = /(^|[^\d+])(?:\+84|84|0)(?:[\s.-]?\d){9}(?!\d)/g;
const CMND_PATTERN = /(^|\D)\d{9}(?!\d)/g;

function scrubNonUuidSegment(segment: string): string {
  if (segment === '') {
    return segment;
  }
  return segment
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(JWT_PATTERN, '[JWT]')
    .replace(EXPO_PUSH_TOKEN_PATTERN, 'ExponentPushToken[REDACTED]')
    .replace(SENSITIVE_QUERY_PARAM_PATTERN, '$1[REDACTED]')
    .replace(EMAIL_PATTERN, '[EMAIL]')
    .replace(CCCD_PATTERN, '$1[CCCD]')
    .replace(VN_PHONE_PATTERN, '$1[PHONE]')
    .replace(CMND_PATTERN, '$1[ID]');
}

/**
 * Che PII và token trong chuỗi bất kỳ, đồng thời giữ nguyên UUID (ví dụ `/chat/<uuid>`).
 */
export function scrubString(input: string): string {
  const parts = input.split(UUID_SPLIT_PATTERN);
  return parts.map((part, index) => (index % 2 === 0 ? scrubNonUuidSegment(part) : part)).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneAsRecord(obj: object): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    copy[key] = value;
  }
  return copy;
}

function scrubValue(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (depth > MAX_SCRUB_DEPTH) {
    return REDACTED;
  }
  if (typeof value === 'string') {
    return scrubString(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date || value instanceof RegExp) {
    return value;
  }
  if (ancestors.has(value)) {
    return '[Circular]';
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => scrubValue(item, depth + 1, ancestors));
    }

    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEY_SET.has(lowerKey)) {
        result[key] = REDACTED;
      } else if (PRESERVED_KEY_SET.has(lowerKey) && typeof entryValue === 'string') {
        result[key] = entryValue;
      } else {
        result[key] = scrubValue(entryValue, depth + 1, ancestors);
      }
    }
    return result;
  } catch {
    return REDACTED;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Duyệt sâu để che PII trong dữ liệu tuỳ ý; an toàn trước vòng tham chiếu và độ sâu quá giới hạn.
 */
export function scrubData(value: unknown): unknown {
  try {
    return scrubValue(value, 0, new WeakSet<object>());
  } catch {
    return REDACTED;
  }
}

/**
 * Che PII trong breadcrumb của Sentry trước khi đính kèm vào sự kiện lỗi.
 */
export function scrubBreadcrumb<B extends object>(breadcrumb: B): B {
  const copy = cloneAsRecord(breadcrumb);

  if (typeof copy['message'] === 'string') {
    copy['message'] = scrubString(copy['message']);
  }
  if ('data' in copy && copy['data'] !== undefined) {
    copy['data'] = scrubData(copy['data']);
  }

  return copy as B;
}

/**
 * Làm sạch event Sentry trước khi gửi: loại bỏ định danh người dùng/máy chủ và che PII ở mọi trường nhạy cảm.
 */
export function scrubEvent<E extends object>(event: E): E {
  const copy = cloneAsRecord(event);

  delete copy['user'];
  delete copy['server_name'];

  if (typeof copy['message'] === 'string') {
    copy['message'] = scrubString(copy['message']);
  }

  if (isRecord(copy['logentry'])) {
    const logentryCopy = cloneAsRecord(copy['logentry']);
    if (typeof logentryCopy['message'] === 'string') {
      logentryCopy['message'] = scrubString(logentryCopy['message']);
    }
    if ('params' in logentryCopy && logentryCopy['params'] !== undefined) {
      logentryCopy['params'] = scrubData(logentryCopy['params']);
    }
    copy['logentry'] = logentryCopy;
  }

  if (isRecord(copy['exception'])) {
    const exceptionCopy = cloneAsRecord(copy['exception']);
    if (Array.isArray(exceptionCopy['values'])) {
      exceptionCopy['values'] = exceptionCopy['values'].map((item) => {
        if (!isRecord(item)) {
          return item;
        }
        const itemCopy = cloneAsRecord(item);
        if (typeof itemCopy['value'] === 'string') {
          itemCopy['value'] = scrubString(itemCopy['value']);
        }
        return itemCopy;
      });
    }
    copy['exception'] = exceptionCopy;
  }

  if (Array.isArray(copy['breadcrumbs'])) {
    copy['breadcrumbs'] = copy['breadcrumbs'].map((item) => (isRecord(item) ? scrubBreadcrumb(item) : item));
  }

  if (isRecord(copy['request'])) {
    const requestCopy = cloneAsRecord(copy['request']);
    delete requestCopy['cookies'];
    delete requestCopy['data'];
    delete requestCopy['query_string'];
    delete requestCopy['env'];

    if (typeof requestCopy['url'] === 'string') {
      requestCopy['url'] = scrubString(requestCopy['url']);
    }
    if ('headers' in requestCopy && requestCopy['headers'] !== undefined) {
      requestCopy['headers'] = scrubData(requestCopy['headers']);
    }
    copy['request'] = requestCopy;
  }

  for (const key of ['extra', 'contexts', 'tags'] as const) {
    if (key in copy && copy[key] !== undefined) {
      copy[key] = scrubData(copy[key]);
    }
  }

  return copy as E;
}
