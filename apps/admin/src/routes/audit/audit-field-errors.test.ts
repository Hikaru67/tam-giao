import { describe, it, expect } from 'vitest';
import { ApiError } from '@tamgiao/api-client';
import { auditFieldErrors } from './audit-field-errors';
import { AUDIT_COPY } from './copy';

describe('auditFieldErrors', () => {
  it('map đúng các trường bộ lọc khi gặp mã VALIDATION_FAILED', () => {
    const error = new ApiError({
      code: 'VALIDATION_FAILED',
      status: 422,
      message: 'Validation failed',
      fieldErrors: [
        { path: 'actorId', message: 'Invalid UUID' },
        { path: 'from', message: 'Invalid date' },
        { path: 'to', message: 'Invalid date' },
        { path: 'targetType', message: 'Too long' },
        { path: 'targetId', message: 'Too long' },
        { path: 'actorType', message: 'Invalid enum' },
      ],
    });

    const result = auditFieldErrors(error);

    expect(result).toEqual({
      actorId: AUDIT_COPY.fieldErrors.actorId,
      from: AUDIT_COPY.fieldErrors.from,
      to: AUDIT_COPY.fieldErrors.to,
      targetType: AUDIT_COPY.fieldErrors.targetType,
      targetId: AUDIT_COPY.fieldErrors.targetId,
      actorType: AUDIT_COPY.fieldErrors.actorType,
    });
  });

  it('bỏ qua các path lạ không thuộc bộ lọc (ví dụ: cursor, action, limit)', () => {
    const error = new ApiError({
      code: 'VALIDATION_FAILED',
      status: 422,
      message: 'Validation failed',
      fieldErrors: [
        { path: 'cursor', message: 'Invalid cursor' },
        { path: 'action', message: 'Unknown action' },
        { path: 'limit', message: 'Must be positive' },
        { path: 'actorId', message: 'Invalid UUID' },
      ],
    });

    const result = auditFieldErrors(error);

    expect(result).toEqual({
      actorId: AUDIT_COPY.fieldErrors.actorId,
    });
    expect(result).not.toHaveProperty('cursor');
    expect(result).not.toHaveProperty('action');
    expect(result).not.toHaveProperty('limit');
  });

  it('trả về đối tượng rỗng khi mã lỗi khác VALIDATION_FAILED', () => {
    const error = new ApiError({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Forbidden',
      fieldErrors: [{ path: 'actorId', message: 'Invalid UUID' }],
    });

    expect(auditFieldErrors(error)).toEqual({});
  });

  it('trả về đối tượng rỗng khi lỗi không phải ApiError', () => {
    expect(auditFieldErrors(new Error('Unknown error'))).toEqual({});
    expect(auditFieldErrors(null)).toEqual({});
    expect(auditFieldErrors(undefined)).toEqual({});
    expect(auditFieldErrors({ code: 'VALIDATION_FAILED' })).toEqual({});
  });
});
