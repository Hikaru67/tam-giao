import { errorRegistry } from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import { IDENTITY_ERRORS } from '../domain/errors.js';

describe('mã lỗi identity', () => {
  it.each(IDENTITY_ERRORS)('%s đã đăng ký HTTP status trong contracts', (code) => {
    expect(errorRegistry.get(code)).toBeDefined();
  });
});
