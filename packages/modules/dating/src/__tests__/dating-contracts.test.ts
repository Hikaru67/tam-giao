import {
  DATE_CANCELLED,
  DATE_CONFIRMED,
  DATE_DECLINED,
  DATE_EXPIRED,
  DATE_PLAN_STATUS_NAMES,
  DATE_PROPOSED,
  errorRegistry,
} from '@tamgiao/contracts';
import * as contracts from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import * as domain from '../domain/date-feedback.js';
import { DATE_PLAN_STATUSES } from '../domain/date-plan.js';
import { DATING_EVENT_TYPES } from '../domain/date-plan-events.js';
import { DATING_DOMAIN_ERRORS, DATING_FEEDBACK_ERRORS, DATING_REUSED_ERRORS } from '../domain/errors.js';

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
      ['CANCEL_TOO_LATE', 'verification', 409],
      ['NOT_PARTICIPANT', 'matching', 403],
      ['PARTNER_NOT_FOUND', 'billing', 404],
      ['NOT_FOUND', 'common', 404],
      ['INVALID_ID', 'common', 400],
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
    ]);
  });

  it('trạng thái lịch hẹn', () => {
    expect([...DATE_PLAN_STATUSES]).toEqual([...DATE_PLAN_STATUS_NAMES]);
  });
});

describe('đánh giá sau gặp (BE-S7-03) khớp contracts', () => {
  it('mã lỗi feedback đăng ký bởi dating với đúng HTTP status', () => {
    expect(DATING_FEEDBACK_ERRORS.map((c) => [c, errorRegistry.get(c)?.owner, errorRegistry.statusOf(c)])).toEqual([
      ['FEEDBACK_INVALID', 'dating', 422],
      ['FEEDBACK_NOT_ALLOWED', 'dating', 409],
      ['FEEDBACK_ALREADY_SUBMITTED', 'dating', 409],
      ['FEEDBACK_NOT_FOUND', 'dating', 404],
    ]);
  });

  it('tên event, enum câu trả lời và giới hạn trùng với contracts', () => {
    expect(domain.FEEDBACK_SUBMITTED).toBe(contracts.FEEDBACK_SUBMITTED);
    expect([...domain.FEEDBACK_PROFILE_MATCHES]).toEqual([...contracts.FEEDBACK_PROFILE_MATCH_NAMES]);
    expect([...domain.FEEDBACK_FEELINGS]).toEqual([...contracts.FEEDBACK_FEELING_NAMES]);
    expect([...domain.FEEDBACK_DECISIONS]).toEqual([...contracts.FEEDBACK_DECISION_NAMES]);
    expect([...domain.FEEDBACK_STOP_REASONS]).toEqual([...contracts.FEEDBACK_STOP_REASON_NAMES]);
    expect([domain.FEEDBACK_RATING_MIN, domain.FEEDBACK_RATING_MAX, domain.FEEDBACK_NOTE_MAX_LENGTH]).toEqual([
      contracts.FEEDBACK_RATING_MIN,
      contracts.FEEDBACK_RATING_MAX,
      contracts.FEEDBACK_NOTE_MAX_LENGTH,
    ]);
    expect(contracts.FEEDBACK_OUTCOME_NAMES).toEqual(['SUCCESS', 'STOPPED']);
  });
});
