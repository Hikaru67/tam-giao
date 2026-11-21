import {
  REPORT_CATEGORY_NAMES,
  REPORT_DESCRIPTION_MAX_LENGTH as DTO_DESCRIPTION_MAX_LENGTH,
  REPORT_FILED,
  REPORT_MAX_EVIDENCE as DTO_MAX_EVIDENCE,
  REPORT_SEVERITY_NAMES,
  REPORT_STATUS_CHANGED,
  REPORT_STATUS_NAMES,
  USER_BANNED as CONTRACT_USER_BANNED,
  REPORT_CONCLUSION_MAX_LENGTH as DTO_CONCLUSION_MAX_LENGTH,
  BAN_REASON_MAX_LENGTH as DTO_BAN_REASON_MAX_LENGTH,
  errorRegistry,
} from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import { SAFETY_DOMAIN_ERRORS } from '../domain/errors.js';
import { REPORT_EVENT_TYPES, USER_BANNED } from '../domain/report-events.js';
import { BAN_REASON_MAX_LENGTH } from '../domain/user-ban.js';
import {
  REPORT_CATEGORIES,
  REPORT_CONCLUSION_MAX_LENGTH,
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_MAX_EVIDENCE,
  REPORT_SEVERITIES,
  REPORT_STATUSES,
} from '../domain/report.js';

describe('mã lỗi safety', () => {
  it.each(SAFETY_DOMAIN_ERRORS)('%s đã đăng ký trong contracts bởi safety', (code) => {
    expect(errorRegistry.get(code)?.owner).toBe('safety');
  });

  it('HTTP status theo hợp đồng', () => {
    expect(SAFETY_DOMAIN_ERRORS.map((c) => [c, errorRegistry.statusOf(c)])).toEqual([
      ['REPORT_TARGET_INVALID', 422],
      ['REPORT_DESCRIPTION_TOO_LONG', 422],
      ['REPORT_EVIDENCE_TOO_MANY', 422],
      ['REPORT_INVALID_TRANSITION', 409],
      ['REPORT_NOT_FOUND', 404],
      ['REPORT_CONCLUSION_INVALID', 422],
      ['BAN_REASON_INVALID', 422],
      ['USER_ALREADY_BANNED', 409],
      ['FLAGGED_MESSAGE_NOT_FOUND', 404],
    ]);
  });
});

// Domain không được import contracts ngoài `constants` (A1) → giữ bản sao, test này bảo đảm hai nơi khớp nhau.
describe('enum / giới hạn / tên event safety khớp contracts', () => {
  it('enum', () => {
    expect([...REPORT_CATEGORIES]).toEqual([...REPORT_CATEGORY_NAMES]);
    expect([...REPORT_SEVERITIES]).toEqual([...REPORT_SEVERITY_NAMES]);
    expect([...REPORT_STATUSES]).toEqual([...REPORT_STATUS_NAMES]);
  });

  it('giới hạn mô tả + số bằng chứng', () => {
    expect(REPORT_DESCRIPTION_MAX_LENGTH).toBe(DTO_DESCRIPTION_MAX_LENGTH);
    expect(REPORT_MAX_EVIDENCE).toBe(DTO_MAX_EVIDENCE);
    expect(REPORT_CONCLUSION_MAX_LENGTH).toBe(DTO_CONCLUSION_MAX_LENGTH);
    expect(BAN_REASON_MAX_LENGTH).toBe(DTO_BAN_REASON_MAX_LENGTH);
  });

  it('event types', () => {
    expect([...REPORT_EVENT_TYPES]).toEqual([REPORT_FILED, REPORT_STATUS_CHANGED]);
    expect(USER_BANNED).toBe(CONTRACT_USER_BANNED);
  });
});
