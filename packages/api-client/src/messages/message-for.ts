import { ERROR_MESSAGES } from './error-messages.js';

/**
 * Tra cứu thông điệp lỗi tiếng Việt thân thiện theo mã lỗi và metadata đi kèm.
 * Nếu mã lỗi không có trong từ điển, trả về câu thông báo mặc định dựa theo HTTP status.
 */
export function messageFor(error: {
  code: string;
  status?: number;
  meta?: Readonly<Record<string, unknown>> | undefined;
}): { title: string; action?: string } {
  const item = ERROR_MESSAGES[error.code];

  if (!item) {
    if (
      (error.status !== undefined && error.status >= 500) ||
      error.code === 'HTTP_5xx' ||
      /^HTTP_5\d\d$/i.test(error.code)
    ) {
      return { title: 'Hệ thống đang bận, vui lòng thử lại sau.' };
    }
    if (error.status === 404 || error.code === 'HTTP_404') {
      return { title: 'Không tìm thấy nội dung bạn yêu cầu.' };
    }
    if (error.status === 403 || error.code === 'HTTP_403') {
      return { title: 'Bạn không có quyền thực hiện thao tác này.' };
    }
    return { title: 'Đã có lỗi xảy ra, vui lòng thử lại.' };
  }

  const { title, action } = item;
  if (!action) {
    return { title };
  }

  const placeholderRegex = /\{([a-zA-Z0-9_]+)\}/g;
  const matches = [...action.matchAll(placeholderRegex)];

  if (matches.length === 0) {
    return { title, action };
  }

  const meta = error.meta;
  if (!meta) {
    return { title };
  }

  for (const match of matches) {
    const key = match[1];
    if (key === undefined) {
      return { title };
    }
    const val = meta[key];
    if (typeof val !== 'string' && typeof val !== 'number') {
      return { title };
    }
  }

  const formattedAction = action.replace(placeholderRegex, (_substr, key: string) => {
    return String(meta[key]);
  });

  return { title, action: formattedAction };
}
