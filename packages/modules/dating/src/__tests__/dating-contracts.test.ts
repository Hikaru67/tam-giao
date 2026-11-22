import {
  CHECK_IN_SOURCE_NAMES,
  DATE_CANCELLED,
  DATE_CHECK_IN_OVERDUE,
  DATE_CHECKED_IN,
  DATE_CONFIRMED,
  DATE_DECLINED,
  DATE_EXPIRED,
  DATE_PARTICIPANT_CHECKED_IN,
  DATE_PARTICIPANT_CHECKED_OUT,
  DATE_PLAN_STATUS_NAMES,
  DATE_PROPOSED,
  errorRegistry,
} from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import { CHECK_IN_SOURCES, DATE_PLAN_STATUSES } from '../domain/date-plan.js';
import { DATING_EVENT_TYPES } from '../domain/date-plan-events.js';
import { DATING_DOMAIN_ERRORS, DATING_REUSED_ERRORS } from '../domain/errors.js';

describe('mã lỗi dating', () => {
  it.each(DATING_DOMAIN_ERRORS)('%s đã đăng ký trong contracts bởi dating', (code) => {
    expect(errorRegistry.get(code)?.owner).toBe('dating');
  });

  it('HTTP status theo hợp đồng (kể cả mã dùng lại của module khác)', () => {
    const all = [...DATING_DOMAIN_ERRORS, ...DATING_REUSED_ERRORS];
    expect(all.map((c) => [c, errorRegistry.get(c)?.owner, errorRegistry.statusOf(c)])).toEqual([
      ['MATCH_NOT_DATING', 'dating', 409],
      ['DATE_ALREADY_OPEN', 'dating', 409],
      ['DATE_TIME_INVALID', 'dating', 422],
      ['DATE_NOT_INVITEE', 'dating', 403],
      ['DATE_RESPONSE_EXPIRED', 'dating', 409],
      ['DATE_INVALID_TRANSITION', 'dating', 409],
      ['DATE_CHECK_IN_WINDOW_CLOSED', 'dating', 409],
      ['DATE_ALREADY_CHECKED_IN', 'dating', 409],
      ['DATE_NOT_CHECKED_IN', 'dating', 409],
      ['CANCEL_TOO_LATE', 'verification', 409],
      ['NOT_PARTICIPANT', 'matching', 403],
      ['PARTNER_NOT_FOUND', 'billing', 404],
      ['NOT_FOUND', 'common', 404],
      ['INVALID_ID', 'common', 400],
      ['VALIDATION_FAILED', 'common', 422],
    ]);
  });
});

// Domain không được import contracts ngoài `constants` (A1) → giữ bản sao, test này bảo đảm hai nơi khớp nhau.
describe('tên event / trạng thái dating khớp contracts', () => {
  it('event types', () => {
    expect([...DATING_EVENT_TYPES]).toEqual([
      DATE_PROPOSED,
      DATE_CONFIRMED,
      DATE_DECLINED,
      DATE_EXPIRED,
      DATE_CANCELLED,
      DATE_CHECKED_IN,
      DATE_PARTICIPANT_CHECKED_IN,
      DATE_PARTICIPANT_CHECKED_OUT,
      DATE_CHECK_IN_OVERDUE,
    ]);
  });

  it('nguồn check-in', () => {
    expect([...CHECK_IN_SOURCES]).toEqual([...CHECK_IN_SOURCE_NAMES]);
  });

  it('trạng thái lịch hẹn', () => {
    expect([...DATE_PLAN_STATUSES]).toEqual([...DATE_PLAN_STATUS_NAMES]);
  });
});
