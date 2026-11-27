/**
 * Helper thuần sinh Content-Security-Policy và security headers cho web app (admin, partner) lúc build & preview
 * (FE-S6-03). File này không import module nào để dùng chung được cho cả Vite config (Node) và test.
 *
 * Lưu ý kiến trúc & bảo mật:
 * - `img-src` cho phép `https:` vì URL presigned của ảnh hồ sơ/eKYC/bằng chứng do BE cấp phụ thuộc hạ tầng
 *   object storage (D5 chưa chốt host cố định).
 * - Trình duyệt web không có cơ chế kỹ thuật nào chặn người dùng chụp màn hình; lớp bảo vệ rò rỉ dữ liệu
 *   nhạy cảm trên web dựa vào CSP chặt, `Referrer-Policy: no-referrer`, presigned URL ngắn hạn và audit log.
 */

export interface WebSecurityOptions {
  /** URL tuyệt đối của API (VITE_API_URL). */
  readonly apiUrl: string;
  /** URL tuyệt đối khác được phép gọi (vd DSN giám sát lỗi) — chỉ lấy origin. */
  readonly extraConnectUrls?: readonly string[];
  /** Partner (PWA quét QR) cần camera; admin thì không. */
  readonly allowCamera: boolean;
}

/** Chuẩn hoá về origin của URL tuyệt đối (chỉ nhận http/https/ws/wss). */
export function originOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL không hợp lệ hoặc không phải URL tuyệt đối: ${url}`);
  }

  if (
    parsed.protocol !== 'http:' &&
    parsed.protocol !== 'https:' &&
    parsed.protocol !== 'ws:' &&
    parsed.protocol !== 'wss:'
  ) {
    throw new Error(`Scheme URL không được hỗ trợ (${parsed.protocol}): ${url}`);
  }

  if (parsed.origin === 'null') {
    throw new Error(`Không xác định được origin cho URL: ${url}`);
  }

  return parsed.origin;
}

/** Sinh chuỗi Content-Security-Policy cho thẻ `<meta>` hoặc HTTP response header. */
export function buildContentSecurityPolicy(options: WebSecurityOptions, target: 'meta' | 'header'): string {
  const apiOrigin = originOf(options.apiUrl);
  const apiParsed = new URL(options.apiUrl);

  // Khi API chạy http:// (môi trường local), cho phép ảnh presigned từ object storage local cùng host khác port.
  const imgSrc =
    apiParsed.protocol === 'http:'
      ? `img-src 'self' data: blob: https: http://${apiParsed.hostname}:*`
      : `img-src 'self' data: blob: https:`;

  const connectOrigins: string[] = [apiOrigin];
  for (const extraUrl of options.extraConnectUrls ?? []) {
    const extraOrigin = originOf(extraUrl);
    if (!connectOrigins.includes(extraOrigin)) {
      connectOrigins.push(extraOrigin);
    }
  }

  const directives = [
    `default-src 'self'`,
    `script-src 'self'`,
    `style-src 'self' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    imgSrc,
    `connect-src 'self' ${connectOrigins.join(' ')}`,
    `media-src 'self' blob:`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-src 'none'`,
  ];

  // Thẻ <meta http-equiv="Content-Security-Policy"> không hỗ trợ directive frame-ancestors.
  if (target === 'header') {
    directives.push(`frame-ancestors 'none'`);
  }

  return directives.join('; ');
}

/** Sinh tập HTTP security headers cho hosting tĩnh (`_headers`) và `vite preview`. */
export function buildSecurityHeaders(
  options: WebSecurityOptions | null,
  opts: { hsts: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (options !== null) {
    headers['Content-Security-Policy'] = buildContentSecurityPolicy(options, 'header');
  }

  headers['X-Content-Type-Options'] = 'nosniff';
  headers['Referrer-Policy'] = 'no-referrer';
  headers['X-Frame-Options'] = 'DENY';
  headers['Cross-Origin-Opener-Policy'] = 'same-origin';
  headers['Permissions-Policy'] = options?.allowCamera
    ? 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()'
    : 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

  if (opts.hsts) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }

  return headers;
}

/** Xuất nội dung file `_headers` theo chuẩn Netlify / Cloudflare Pages. */
export function renderStaticHeadersFile(headers: Record<string, string>): string {
  const lines = [
    '# Sinh tự động lúc build (FE-S6-03) — không sửa tay.',
    '/*',
    ...Object.entries(headers).map(([key, value]) => `  ${key}: ${value}`),
    '/index.html',
    '  Cache-Control: no-cache',
    '/sw.js',
    '  Cache-Control: no-cache',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
  ];
  return `${lines.join('\n')}\n`;
}

/** Chèn thẻ `<meta http-equiv="Content-Security-Policy">` vào HTML ngay sau `<meta charset...>`. */
export function injectCspMeta(html: string, csp: string): string {
  if (/http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(html)) {
    throw new Error('HTML đã có thẻ meta Content-Security-Policy (FE-S6-03).');
  }

  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (!headMatch) {
    throw new Error('Không tìm thấy thẻ <head> trong HTML để chèn Content-Security-Policy.');
  }

  const escapedCsp = csp.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${escapedCsp}" />`;

  const charsetMatch = /([ \t]*)<meta\s+charset\b[^>]*>/i.exec(html);
  if (charsetMatch) {
    const insertAt = charsetMatch.index + charsetMatch[0].length;
    const indent = charsetMatch[1] ?? '';
    return `${html.slice(0, insertAt)}\n${indent}${metaTag}${html.slice(insertAt)}`;
  }

  const headInsertAt = headMatch.index + headMatch[0].length;
  return `${html.slice(0, headInsertAt)}\n    ${metaTag}${html.slice(headInsertAt)}`;
}
