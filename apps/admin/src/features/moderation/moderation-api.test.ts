import { describe, it, expect } from 'vitest';
import { PRESIGNED_URL_TTL_SECONDS } from '@tamgiao/contracts/constants';
import type { ReportDetailResponse } from '@tamgiao/contracts/safety';
import {
  evidenceRefreshDelayMs,
  isEvidenceRefreshDue,
  PRESIGNED_REFRESH_MARGIN_MS,
  PRESIGNED_REFRESH_MIN_DELAY_MS,
} from './moderation-api';

describe('evidenceRefreshDelayMs', () => {
  const makeDetail = (evidence: ReportDetailResponse['evidence'] = []): ReportDetailResponse => ({
    reportId: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e01',
    reporterId: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e02',
    reportedUserId: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e03',
    matchId: '0193a4f2-7c3e-7b1a-9f2d-3c4b5a6d7e04',
    category: 'FINANCIAL_SCAM',
    severity: 'HIGH',
    status: 'OPEN',
    urgent: false,
    dueAt: null,
    overdue: false,
    handledBy: null,
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    description: null,
    evidence,
    conclusion: null,
    closedAt: null,
    version: 1,
  });

  it('không có ảnh hoặc detail undefined → false', () => {
    expect(evidenceRefreshDelayMs(undefined, 1000, 1000)).toBe(false);
    expect(evidenceRefreshDelayMs(makeDetail([]), 1000, 1000)).toBe(false);
  });

  it('có ảnh → trả về thời gian chờ trước hạn một khoảng PRESIGNED_REFRESH_MARGIN_MS', () => {
    const fetchedAt = 1_000_000;
    const expiresAt = new Date(fetchedAt + 100_000).toISOString();
    const detail = makeDetail([{ key: 'key1', url: 'https://example.com/img1.jpg', expiresAt }]);

    const now = fetchedAt;
    const delay = evidenceRefreshDelayMs(detail, fetchedAt, now);
    expect(delay).toBe(100_000 - PRESIGNED_REFRESH_MARGIN_MS);
  });

  it('tối thiểu PRESIGNED_REFRESH_MIN_DELAY_MS', () => {
    const fetchedAt = 1_000_000;
    const expiresAt = new Date(fetchedAt + 10_000).toISOString();
    const detail = makeDetail([{ key: 'key1', url: 'https://example.com/img1.jpg', expiresAt }]);

    const now = fetchedAt + 50_000; // đã quá hạn margin
    const delay = evidenceRefreshDelayMs(detail, fetchedAt, now);
    expect(delay).toBe(PRESIGNED_REFRESH_MIN_DELAY_MS);
    expect(isEvidenceRefreshDue(detail, fetchedAt, now)).toBe(true);
  });

  it('không quá PRESIGNED_URL_TTL_SECONDS kể từ fetchedAt', () => {
    const fetchedAt = 1_000_000;
    // expiresAt server trả ở tương lai xa
    const expiresAt = new Date(fetchedAt + (PRESIGNED_URL_TTL_SECONDS + 500) * 1000).toISOString();
    const detail = makeDetail([{ key: 'key1', url: 'https://example.com/img1.jpg', expiresAt }]);

    const now = fetchedAt;
    const delay = evidenceRefreshDelayMs(detail, fetchedAt, now);
    expect(delay).toBe(PRESIGNED_URL_TTL_SECONDS * 1000 - PRESIGNED_REFRESH_MARGIN_MS);
  });
});
