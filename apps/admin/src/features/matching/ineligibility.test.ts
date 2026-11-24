import { describe, it, expect } from 'vitest';
import { ApiError } from '@tamgiao/api-client';
import { ineligibilityFromError } from './ineligibility';

describe('ineligibilityFromError', () => {
  const pair = {
    userAId: '01890a5d-ac96-774b-bcce-b302099a8001',
    userBId: '01890a5d-ac96-774b-bcce-b302099a8002',
  };

  it('trả về null nếu không phải ApiError', () => {
    expect(ineligibilityFromError(new Error('network error'), pair)).toBeNull();
    expect(ineligibilityFromError('string error', pair)).toBeNull();
    expect(ineligibilityFromError(null, pair)).toBeNull();
  });

  it('trả về null nếu mã lỗi không thuộc ineligibleReasons', () => {
    const error = new ApiError({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'test',
    });
    expect(ineligibilityFromError(error, pair)).toBeNull();
  });

  it('trích xuất đúng code và userIds khi meta.userIds khớp', () => {
    const error = new ApiError({
      status: 409,
      code: 'USER_COOLING_DOWN',
      message: 'test',
      meta: { userIds: [pair.userBId] },
    });
    const result = ineligibilityFromError(error, pair);
    expect(result).toEqual({
      code: 'USER_COOLING_DOWN',
      userIds: [pair.userBId],
    });
  });

  it('lọc bỏ các userIds không thuộc cặp', () => {
    const foreignId = '01890a5d-ac96-774b-bcce-b302099a8999';
    const error = new ApiError({
      status: 409,
      code: 'USER_BUSY',
      message: 'test',
      meta: { userIds: [pair.userAId, foreignId] },
    });
    const result = ineligibilityFromError(error, pair);
    expect(result).toEqual({
      code: 'USER_BUSY',
      userIds: [pair.userAId],
    });
  });

  it('mặc định trả về [userBId] nếu không có meta hoặc không khớp ID nào trong cặp', () => {
    const errorNoMeta = new ApiError({
      status: 409,
      code: 'PAIR_ALREADY_TRIED',
      message: 'test',
    });
    expect(ineligibilityFromError(errorNoMeta, pair)).toEqual({
      code: 'PAIR_ALREADY_TRIED',
      userIds: [pair.userBId],
    });

    const errorForeignMeta = new ApiError({
      status: 409,
      code: 'USER_NOT_VERIFIED',
      message: 'test',
      meta: { userIds: ['01890a5d-ac96-774b-bcce-b302099a8999'] },
    });
    expect(ineligibilityFromError(errorForeignMeta, pair)).toEqual({
      code: 'USER_NOT_VERIFIED',
      userIds: [pair.userBId],
    });
  });
});
