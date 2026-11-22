import { isApiError } from '@tamgiao/api-client';
import { isAuditFilterField, type AuditFilterField } from './audit-search';
import { AUDIT_COPY } from './copy';

export function auditFieldErrors(error: unknown): Partial<Record<AuditFilterField, string>> {
  if (!isApiError(error) || error.code !== 'VALIDATION_FAILED') {
    return {};
  }

  const result: Partial<Record<AuditFilterField, string>> = {};
  for (const item of error.fieldErrors) {
    if (isAuditFilterField(item.path)) {
      result[item.path] = AUDIT_COPY.fieldErrors[item.path];
    }
  }
  return result;
}
