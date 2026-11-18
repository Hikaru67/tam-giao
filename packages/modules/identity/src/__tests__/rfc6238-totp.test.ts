import { describe, expect, it } from 'vitest';
import { Rfc6238Totp } from '../infrastructure/rfc6238-totp.js';

describe('Rfc6238Totp', () => {
  const totp = new Rfc6238Totp();
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  describe('Test vector RFC 6238 Phụ lục B SHA1', () => {
    const vectors = [
      { time: 59, expectedCode: '287082', expectedStep: Math.floor(59 / 30) },
      { time: 1111111109, expectedCode: '081804', expectedStep: Math.floor(1111111109 / 30) },
      { time: 1111111111, expectedCode: '050471', expectedStep: Math.floor(1111111111 / 30) },
      { time: 1234567890, expectedCode: '005924', expectedStep: Math.floor(1234567890 / 30) },
      { time: 2000000000, expectedCode: '279037', expectedStep: Math.floor(2000000000 / 30) },
    ];

    it.each(vectors)(
      'sinh đúng mã $expectedCode và verify trả về đúng bước $expectedStep tại T=$time',
      ({ time, expectedCode, expectedStep }) => {
        const now = new Date(time * 1000);
        expect(totp.generate(rfcSecret, now)).toBe(expectedCode);
        const verifiedStep = totp.verify(rfcSecret, expectedCode, now);
        expect(verifiedStep).toBe(expectedStep);
      },
    );
  });

  describe('Cửa sổ dung sai thời gian ±1 bước', () => {
    // T = 1234567890, step = 41152263, code = '005924'
    const baseTime = 1234567890;
    const baseStep = Math.floor(baseTime / 30);
    const validCode = '005924';

    it('chấp nhận mã đúng thời điểm hiện tại', () => {
      const now = new Date(baseTime * 1000);
      expect(totp.verify(rfcSecret, validCode, now)).toBe(baseStep);
    });

    it('chấp nhận mã khi thời gian lệch chậm 1 bước (+30s)', () => {
      const now = new Date((baseTime + 30) * 1000);
      expect(totp.verify(rfcSecret, validCode, now)).toBe(baseStep);
    });

    it('chấp nhận mã khi thời gian lệch nhanh 1 bước (-30s)', () => {
      const now = new Date((baseTime - 30) * 1000);
      expect(totp.verify(rfcSecret, validCode, now)).toBe(baseStep);
    });

    it('từ chối mã khi thời gian lệch nhanh 2 bước (-60s)', () => {
      const now = new Date((baseTime - 60) * 1000);
      expect(totp.verify(rfcSecret, validCode, now)).toBeNull();
    });

    it('từ chối mã khi thời gian lệch chậm 2 bước (+60s)', () => {
      const now = new Date((baseTime + 60) * 1000);
      expect(totp.verify(rfcSecret, validCode, now)).toBeNull();
    });
  });

  describe('Từ chối mã sai định dạng', () => {
    const now = new Date(1234567890 * 1000);

    it("từ chối '12345' (thiếu chữ số)", () => {
      expect(totp.verify(rfcSecret, '12345', now)).toBeNull();
    });

    it("từ chối 'abcdef' (chứa chữ cái)", () => {
      expect(totp.verify(rfcSecret, 'abcdef', now)).toBeNull();
    });

    it("từ chối '1234567' (thừa chữ số)", () => {
      expect(totp.verify(rfcSecret, '1234567', now)).toBeNull();
    });
  });

  describe('generateSecret', () => {
    it('sinh secret dài 32 ký tự thuộc bảng chữ cái Base32 [A-Z2-7]', () => {
      const secret = totp.generateSecret();
      expect(secret).toHaveLength(32);
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    });

    it('mỗi lần sinh secret phải cho ra giá trị khác nhau', () => {
      const secret1 = totp.generateSecret();
      const secret2 = totp.generateSecret();
      expect(secret1).not.toBe(secret2);
    });
  });

  describe('otpauthUri', () => {
    it('tạo URI đúng định dạng với account được encodeURIComponent', () => {
      const uri = totp.otpauthUri(rfcSecret, 'admin@tamgiao.vn');
      expect(uri).toBe(
        `otpauth://totp/TamGiao:admin%40tamgiao.vn?secret=${rfcSecret}&issuer=TamGiao&algorithm=SHA1&digits=6&period=30`,
      );
    });

    it('mã hoá đúng các ký tự đặc biệt trong account', () => {
      const uri = totp.otpauthUri(rfcSecret, 'Admin Tam Giao:Test');
      expect(uri).toBe(
        `otpauth://totp/TamGiao:Admin%20Tam%20Giao%3ATest?secret=${rfcSecret}&issuer=TamGiao&algorithm=SHA1&digits=6&period=30`,
      );
    });
  });

  describe('Xử lý secret Base32 không hợp lệ', () => {
    const now = new Date(1234567890 * 1000);

    it('ném Error khi verify với secret chứa ký tự không hợp lệ hoặc rỗng', () => {
      expect(() => totp.verify('INVALID_SECRET_!@#', '005924', now)).toThrow();
      expect(() => totp.verify('12345', '005924', now)).toThrow();
      expect(() => totp.verify('', '005924', now)).toThrow();
    });

    it('ném Error khi otpauthUri với secret không hợp lệ', () => {
      expect(() => totp.otpauthUri('INVALID!', 'admin')).toThrow();
    });
  });
});
