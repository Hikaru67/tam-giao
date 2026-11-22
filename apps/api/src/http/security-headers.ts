import type { MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from '@tamgiao/http';

type SecureHeadersOptions = NonNullable<Parameters<typeof secureHeaders>[0]>;
type CspDirectives = NonNullable<SecureHeadersOptions['contentSecurityPolicy']>;
type PermissionsPolicy = NonNullable<SecureHeadersOptions['permissionsPolicy']>;

/**
 * Directives Content-Security-Policy cho API thông thường.
 * API trả JSON thuần túy, không phục vụ HTML/nội dung động nên cấm tải mọi tài nguyên bên ngoài
 * và cấm nhúng trong iframe để phòng ngừa rủi ro clickjacking và XSS.
 */
const API_CSP_DIRECTIVES = {
  defaultSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'none'"],
} satisfies CspDirectives;

/**
 * Directives Content-Security-Policy riêng cho trang tài liệu Swagger/Scalar (`/docs`).
 * Trang này nạp tài nguyên giao diện từ bên thứ ba (Scalar API Reference):
 * - Script từ cdn.jsdelivr.net để render giao diện.
 * - Styles từ cdn.jsdelivr.net, fonts.scalar.com và inline style ('unsafe-inline') do thư viện tự inject.
 * - Fonts từ fonts.scalar.com, data: URI và cdn.jsdelivr.net.
 * - Images từ 'self', data: và https: (icon, badge).
 * - Connect đến 'self' để tải đặc tả OpenAPI JSON.
 * - Web worker dùng blob: URL cho tính toán của giao diện Scalar.
 * - Không cho phép 'unsafe-eval' để đảm bảo an toàn thực thi mã.
 */
const DOCS_CSP_DIRECTIVES = {
  defaultSrc: ["'none'"],
  scriptSrc: ['https://cdn.jsdelivr.net'],
  styleSrc: ["'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.scalar.com'],
  fontSrc: ['data:', 'https://cdn.jsdelivr.net', 'https://fonts.scalar.com'],
  imgSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'"],
  workerSrc: ['blob:'],
  frameAncestors: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'none'"],
} satisfies CspDirectives;

/** Chuyển camelCase sang kebab-case cho directive CSP theo đúng quy ước của Hono. */
function directiveToKebab(directive: string): string {
  return directive.replace(/[A-Z]+(?![a-z])|[A-Z]/g, (match, offset) =>
    offset ? `-${match.toLowerCase()}` : match.toLowerCase(),
  );
}

/** Chuyển object directive thành chuỗi CSP tương tự cách `hono/secure-headers` ghép chuỗi. */
function buildCspHeaderString(directives: Record<string, readonly string[]>): string {
  return Object.entries(directives)
    .map(([key, values]) => `${directiveToKebab(key)} ${values.join(' ')}`)
    .join('; ');
}

/** CSP cho mọi response JSON của API: không nạp tài nguyên nào, cấm nhúng iframe. */
export const API_CONTENT_SECURITY_POLICY: string = buildCspHeaderString(API_CSP_DIRECTIVES);

/** CSP riêng cho trang tài liệu `/docs` (Scalar nạp từ cdn.jsdelivr.net). */
export const DOCS_CONTENT_SECURITY_POLICY: string = buildCspHeaderString(DOCS_CSP_DIRECTIVES);

export interface SecurityHeadersOptions {
  /** Đường dẫn trang tài liệu được áp CSP riêng (mặc định ['/docs']). */
  readonly docsPaths?: readonly string[] | undefined;
}

const DEFAULT_PERMISSIONS_POLICY = {
  camera: [],
  microphone: [],
  geolocation: [],
  payment: [],
} satisfies PermissionsPolicy;

/**
 * Middleware thiết lập security headers cho HTTP response.
 * Sử dụng `secureHeaders` từ `hono/secure-headers`, phân tách cấu hình CSP riêng
 * cho API và trang tài liệu Swagger/Scalar (`/docs`).
 */
export function securityHeaders(options?: SecurityHeadersOptions): MiddlewareHandler<AppEnv> {
  const docsPaths = new Set(options?.docsPaths ?? ['/docs']);

  const apiHeadersMiddleware = secureHeaders({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: API_CSP_DIRECTIVES,
    permissionsPolicy: DEFAULT_PERMISSIONS_POLICY,
  });

  const docsHeadersMiddleware = secureHeaders({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: DOCS_CSP_DIRECTIVES,
    permissionsPolicy: DEFAULT_PERMISSIONS_POLICY,
  });

  return async (c, next) => {
    const handler = docsPaths.has(c.req.path) ? docsHeadersMiddleware : apiHeadersMiddleware;
    return handler(c, next);
  };
}
