/**
 * Bộ lọc nhật ký truy cập lưu trên URL (`/audit?actorType=…&from=…`).
 * Giữ nguyên chuỗi người dùng nhập (không tự sửa) để BE kiểm tra và trả `VALIDATION_FAILED` đúng trường.
 * `from`/`to` là ISO 8601 (UTC) đúng như tham số của `GET /admin/audit-logs`.
 */
export const AUDIT_FILTER_FIELDS = ['actorType', 'actorId', 'targetType', 'targetId', 'from', 'to'] as const;

export type AuditFilterField = (typeof AUDIT_FILTER_FIELDS)[number];

export type AuditSearch = Partial<Record<AuditFilterField, string>>;

/** `validateSearch` của route `/audit`: chỉ giữ các khoá bộ lọc đã biết, giá trị là chuỗi không rỗng (đã trim). */
export function parseAuditSearch(search: Record<string, unknown>): AuditSearch {
  const result: AuditSearch = {};
  for (const field of AUDIT_FILTER_FIELDS) {
    const value = search[field];
    if (typeof value === 'string' && value.trim() !== '') {
      result[field] = value.trim();
    }
  }
  return result;
}

export function isAuditFilterField(path: string): path is AuditFilterField {
  return (AUDIT_FILTER_FIELDS as readonly string[]).includes(path);
}

/** Giá trị cho `<input type="datetime-local">` (giờ máy người xem) từ ISO; ISO sai → chuỗi rỗng. */
export function isoToDateTimeLocal(iso: string | undefined): string {
  if (iso === undefined) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** `datetime-local` (giờ máy người xem) → ISO UTC; rỗng/sai → `undefined`. */
export function dateTimeLocalToIso(local: string): string | undefined {
  if (local.trim() === '') return undefined;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
