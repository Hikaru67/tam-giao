import { ApiError } from '@tamgiao/api-client';
import { PRESIGNED_URL_TTL_SECONDS } from '@tamgiao/contracts/constants';
import { describe, expect, it } from 'vitest';
import {
  PRESIGNED_REFRESH_MARGIN_MS,
  PRESIGNED_REFRESH_MIN_DELAY_MS,
  detailRefreshDelayMs,
  isDetailRefreshDue,
  isKycConflictError,
  presignedDeadlineMs,
} from './kyc-api';
import { kycDetail } from './kyc-test-fixtures';

describe('presignedDeadlineMs', () => {
  const fetchedAt = 1_000_000;
  const ttlMs = PRESIGNED_URL_TTL_SECONDS * 1000;

  it('lấy expiresAt khi hợp lệ và nhỏ hơn TTL', () => {
    const expiresAtMs = fetchedAt + 50_000;
    const doc = {
      url: 'https://storage.test/img.jpg',
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    expect(presignedDeadlineMs(doc, fetchedAt)).toBe(expiresAtMs);
  });

  it('cắt ở fetchedAt + TTL khi expiresAt quá xa trong tương lai', () => {
    const expiresAtMs = fetchedAt + ttlMs + 50_000;
    const doc = {
      url: 'https://storage.test/img.jpg',
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    expect(presignedDeadlineMs(doc, fetchedAt)).toBe(fetchedAt + ttlMs);
  });

  it('expiresAt <= fetchedAt → coi như còn đủ TTL kể từ lúc nhận', () => {
    const expiresAtMs = fetchedAt - 1_000;
    const doc = {
      url: 'https://storage.test/img.jpg',
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    expect(presignedDeadlineMs(doc, fetchedAt)).toBe(fetchedAt + ttlMs);
  });

  it('ISO hỏng → trả fetchedAt + TTL', () => {
    const doc = { url: 'https://storage.test/img.jpg', expiresAt: 'invalid-iso-date' };
    expect(presignedDeadlineMs(doc, fetchedAt)).toBe(fetchedAt + ttlMs);
  });
});

describe('detailRefreshDelayMs', () => {
  it('detail undefined → trả false', () => {
    expect(detailRefreshDelayMs(undefined, 1000, 1000)).toBe(false);
  });

  it('mọi document null → trả false', () => {
    const detail = kycDetail({
      documents: {
        cccdFront: null,
        cccdBack: null,
        selfie: null,
        maritalStatusCertificate: null,
      },
    });
    expect(detailRefreshDelayMs(detail, 1000, 1000)).toBe(false);
  });

  it('lấy hạn sớm nhất trừ PRESIGNED_REFRESH_MARGIN_MS', () => {
    const fetchedAt = 1_000_000;
    const now = 1_000_000;
    const doc1Expiry = fetchedAt + 100_000;
    const doc2Expiry = fetchedAt + 80_000;
    const detail = kycDetail({
      documents: {
        cccdFront: { url: 'https://storage.test/1', expiresAt: new Date(doc1Expiry).toISOString() },
        cccdBack: { url: 'https://storage.test/2', expiresAt: new Date(doc2Expiry).toISOString() },
        selfie: null,
        maritalStatusCertificate: null,
      },
    });
    const expected = doc2Expiry - PRESIGNED_REFRESH_MARGIN_MS - now;
    expect(detailRefreshDelayMs(detail, fetchedAt, now)).toBe(expected);
  });

  it('không nhỏ hơn PRESIGNED_REFRESH_MIN_DELAY_MS', () => {
    const fetchedAt = 1_000_000;
    const now = 1_000_000;
    const docExpiry = fetchedAt + PRESIGNED_REFRESH_MARGIN_MS + 100;
    const detail = kycDetail({
      documents: {
        cccdFront: { url: 'https://storage.test/1', expiresAt: new Date(docExpiry).toISOString() },
        cccdBack: null,
        selfie: null,
        maritalStatusCertificate: null,
      },
    });
    expect(detailRefreshDelayMs(detail, fetchedAt, now)).toBe(PRESIGNED_REFRESH_MIN_DELAY_MS);
  });
});

describe('isDetailRefreshDue', () => {
  const fetchedAt = 1_000_000;
  const detail = kycDetail({
    documents: {
      cccdFront: { url: 'https://storage.test/1', expiresAt: new Date(fetchedAt + 100_000).toISOString() },
      cccdBack: null,
      selfie: null,
      maritalStatusCertificate: null,
    },
  });

  it('URL còn hạn → không gọi lại chi tiết (tránh thêm bản ghi audit)', () => {
    expect(isDetailRefreshDue(detail, fetchedAt, fetchedAt + 1_000)).toBe(false);
  });

  it('URL đã tới mốc xin lại → gọi lại', () => {
    expect(isDetailRefreshDue(detail, fetchedAt, fetchedAt + 100_000)).toBe(true);
  });

  it('không có ảnh → không gọi lại', () => {
    expect(isDetailRefreshDue(undefined, fetchedAt, fetchedAt)).toBe(false);
  });
});

describe('isKycConflictError', () => {
  it('ApiError code KYC_ALREADY_DECIDED → true', () => {
    const error = new ApiError({
      code: 'KYC_ALREADY_DECIDED',
      status: 409,
      message: 'KYC_ALREADY_DECIDED',
    });
    expect(isKycConflictError(error)).toBe(true);
  });

  it('ApiError code KYC_INVALID_TRANSITION → true', () => {
    const error = new ApiError({
      code: 'KYC_INVALID_TRANSITION',
      status: 409,
      message: 'KYC_INVALID_TRANSITION',
    });
    expect(isKycConflictError(error)).toBe(true);
  });

  it('ApiError code KYC_STEPS_INCOMPLETE → false', () => {
    const error = new ApiError({
      code: 'KYC_STEPS_INCOMPLETE',
      status: 409,
      message: 'KYC_STEPS_INCOMPLETE',
    });
    expect(isKycConflictError(error)).toBe(false);
  });

  it('Error thường → false', () => {
    expect(isKycConflictError(new Error('Network error'))).toBe(false);
  });
});
