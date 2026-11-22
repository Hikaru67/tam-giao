export interface LoginSearch {
  /** Đường dẫn nội bộ cần quay lại sau khi đăng nhập. */
  redirect?: string;
}

/** Chỉ nhận đường dẫn nội bộ (`/…`, không `//…`) để chống open redirect sau đăng nhập. */
export function parseLoginSearch(search: Record<string, unknown>): LoginSearch {
  const r = search.redirect;
  if (typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') && !r.startsWith('/\\')) {
    return { redirect: r };
  }
  return {};
}

/**
 * Đích sau đăng nhập. Phải lọc lại vì TanStack Router gộp search thô của route cha (root) vào search của route,
 * nên `redirect` không an toàn vẫn có thể lọt qua `validateSearch`.
 */
export function safeRedirectTarget(search: Record<string, unknown>): string {
  return parseLoginSearch(search).redirect ?? '/';
}
