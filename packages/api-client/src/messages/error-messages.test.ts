import { describe, expect, it } from 'vitest';
import { errorRegistry } from '@tamgiao/contracts';
import { CLIENT_ERROR_CODES } from '../api-error.js';
import { ERROR_MESSAGES } from './error-messages.js';
import { messageFor } from './message-for.js';

describe('Bảng thông điệp lỗi (FE-S1-04)', () => {
  it('mọi mã lỗi trong errorRegistry đều có trong ERROR_MESSAGES', () => {
    const registryCodes = errorRegistry.list().map((e) => e.code);
    const missingCodes = registryCodes.filter((code) => !(code in ERROR_MESSAGES));

    expect(
      missingCodes,
      `Có ${missingCodes.length} mã lỗi thiếu trong ERROR_MESSAGES:\n${missingCodes.join(', ')}`,
    ).toEqual([]);
  });

  it('mọi mã lỗi trong CLIENT_ERROR_CODES đều có trong ERROR_MESSAGES', () => {
    const missingClientCodes = CLIENT_ERROR_CODES.filter((code) => !(code in ERROR_MESSAGES));

    expect(
      missingClientCodes,
      `Có ${missingClientCodes.length} mã client thiếu trong ERROR_MESSAGES:\n${missingClientCodes.join(', ')}`,
    ).toEqual([]);
  });

  it('không có mã lỗi thừa trong ERROR_MESSAGES', () => {
    const registryCodes = new Set(errorRegistry.list().map((e) => e.code));
    const clientCodes = new Set<string>(CLIENT_ERROR_CODES);
    const extraCodes = Object.keys(ERROR_MESSAGES).filter(
      (code) => !registryCodes.has(code) && !clientCodes.has(code),
    );

    expect(
      extraCodes,
      `Có ${extraCodes.length} mã lỗi thừa trong ERROR_MESSAGES:\n${extraCodes.join(', ')}`,
    ).toEqual([]);
  });

  it('mọi title không rỗng và dài không quá 90 ký tự', () => {
    for (const [code, item] of Object.entries(ERROR_MESSAGES)) {
      expect(item.title.trim().length, `Mã ${code} có title rỗng`).toBeGreaterThan(0);
      expect(
        item.title.length,
        `Mã ${code} có title dài ${item.title.length} ký tự (> 90 ký tự): "${item.title}"`,
      ).toBeLessThanOrEqual(90);
    }
  });

  it('không chứa các từ khoá bị cấm (VNeID, Bộ Công An, ký quỹ, bảo chứng)', () => {
    const FORBIDDEN_WORDS = ['vneid', 'bộ công an', 'ký quỹ', 'bảo chứng'];

    for (const [code, item] of Object.entries(ERROR_MESSAGES)) {
      const combinedText = `${item.title} ${item.action ?? ''}`.toLowerCase();
      for (const word of FORBIDDEN_WORDS) {
        expect(
          combinedText.includes(word),
          `Mã ${code} chứa từ cấm "${word}": title="${item.title}", action="${item.action}"`,
        ).toBe(false);
      }
    }
  });

  describe('messageFor', () => {
    it('thay thế placeholder thành công từ meta khi có giá trị hợp lệ', () => {
      const rateLimited = messageFor({
        code: 'RATE_LIMITED',
        meta: { retryAfterSeconds: 45 },
      });
      expect(rateLimited.title).toBe('Bạn đang thao tác quá nhanh.');
      expect(rateLimited.action).toBe('Vui lòng thử lại sau 45 giây.');

      const messageTooLong = messageFor({
        code: 'MESSAGE_TOO_LONG',
        meta: { maxLength: 2000 },
      });
      expect(messageTooLong.title).toBe('Nội dung tin nhắn vượt quá độ dài tối đa.');
      expect(messageTooLong.action).toBe('Vui lòng rút ngắn tin nhắn xuống dưới 2000 ký tự.');

      const reportEvidence = messageFor({
        code: 'REPORT_EVIDENCE_TOO_MANY',
        meta: { max: 5 },
      });
      expect(reportEvidence.title).toBe('Số lượng ảnh bằng chứng vượt quá mức cho phép.');
      expect(reportEvidence.action).toBe('Vui lòng chọn tối đa 5 ảnh đính kèm.');
    });

    it('bỏ câu action chứa placeholder khi thiếu meta hoặc meta không chứa giá trị string/number', () => {
      // Không truyền meta
      const withoutMeta = messageFor({ code: 'RATE_LIMITED' });
      expect(withoutMeta.title).toBe('Bạn đang thao tác quá nhanh.');
      expect(withoutMeta.action).toBeUndefined();

      // Meta rỗng
      const emptyMeta = messageFor({ code: 'RATE_LIMITED', meta: {} });
      expect(emptyMeta.action).toBeUndefined();

      // Meta có kiểu không phải string/number (vd null hoặc object)
      const invalidTypeMeta = messageFor({
        code: 'RATE_LIMITED',
        meta: { retryAfterSeconds: null },
      });
      expect(invalidTypeMeta.action).toBeUndefined();

      // Đảm bảo không còn ký tự '{' trong toàn bộ kết quả khi thiếu meta
      for (const code of Object.keys(ERROR_MESSAGES)) {
        const res = messageFor({ code });
        if (res.action !== undefined) {
          expect(
            res.action.includes('{'),
            `Mã ${code} thiếu meta nhưng action vẫn còn chứa dấu '{': "${res.action}"`,
          ).toBe(false);
        }
      }
    });

    it('giữ nguyên action không chứa placeholder kể cả khi không có meta', () => {
      const expired = messageFor({ code: 'OFFER_EXPIRED' });
      expect(expired.title).toBe('Gợi ý này đã hết thời gian phản hồi.');
      expect(expired.action).toBe('Hệ thống sẽ gửi gợi ý mới cho bạn.');
    });

    it('trả về câu thông báo mặc định cho mã lỗi lạ theo status và code', () => {
      // 5xx / HTTP_5xx
      expect(messageFor({ code: 'UNKNOWN_CODE', status: 503 })).toEqual({
        title: 'Hệ thống đang bận, vui lòng thử lại sau.',
      });
      expect(messageFor({ code: 'HTTP_5xx' })).toEqual({
        title: 'Hệ thống đang bận, vui lòng thử lại sau.',
      });
      expect(messageFor({ code: 'HTTP_500' })).toEqual({
        title: 'Hệ thống đang bận, vui lòng thử lại sau.',
      });
      expect(messageFor({ code: 'HTTP_502', status: 502 })).toEqual({
        title: 'Hệ thống đang bận, vui lòng thử lại sau.',
      });

      // 404 / HTTP_404
      expect(messageFor({ code: 'UNKNOWN_CODE', status: 404 })).toEqual({
        title: 'Không tìm thấy nội dung bạn yêu cầu.',
      });
      expect(messageFor({ code: 'HTTP_404' })).toEqual({
        title: 'Không tìm thấy nội dung bạn yêu cầu.',
      });

      // 403 / HTTP_403
      expect(messageFor({ code: 'UNKNOWN_CODE', status: 403 })).toEqual({
        title: 'Bạn không có quyền thực hiện thao tác này.',
      });
      expect(messageFor({ code: 'HTTP_403' })).toEqual({
        title: 'Bạn không có quyền thực hiện thao tác này.',
      });

      // Còn lại (status 400 hoặc bất kỳ mã nào khác)
      expect(messageFor({ code: 'UNKNOWN_CODE', status: 400 })).toEqual({
        title: 'Đã có lỗi xảy ra, vui lòng thử lại.',
      });
      expect(messageFor({ code: 'SOMETHING_UNEXPECTED' })).toEqual({
        title: 'Đã có lỗi xảy ra, vui lòng thử lại.',
      });
    });
  });
});
