import { describe, expect, it } from 'vitest';
import { CONTACT_MASK_LABELS as M, ContactMasker } from '../domain/contact-masker.js';
import { parseMessageBody, type MessageBody } from '../domain/message-policy.js';
import { createContentScreener } from '../domain/message-screener.js';

const masker = new ContactMasker();
const body = (raw: string): MessageBody => parseMessageBody(raw).unwrapOr(undefined as never);

describe('ContactMasker (AC2)', () => {
  it.each([
    ['Số em 0912 345 678 nhé', `Số em ${M.PHONE} nhé`],
    ['zalo: 0912345678', `zalo: ${M.PHONE}`],
    ['fb.com/abc', M.LINK],
  ])('AC2: %s → %s', (text, masked) => {
    expect(masker.mask(text)).toBe(masked);
  });

  it.each([
    ['gọi +84 912 345 678 nha', `gọi ${M.PHONE} nha`],
    ['số 0912.345.678 hoặc 0 9 1 2 3 4 5 6 7 9', `số ${M.PHONE} hoặc ${M.PHONE}`],
    ['mail em là lan.nguyen+1@gmail.com', `mail em là ${M.EMAIL}`],
    ['xem https://example.com/a?b=1 nhé', `xem ${M.LINK} nhé`],
    ['vào www.abc.vn xem', `vào ${M.LINK} xem`],
    ['link facebook.com/lan.nguyen nè', `link ${M.LINK} nè`],
    ['ig: lan_nguyen99 nha', `ig: ${M.SOCIAL} nha`],
    ['fb - Lan Nguyễn', `fb - ${M.SOCIAL} Nguyễn`],
    ['insta @lan.nguyen', `insta ${M.SOCIAL}`],
    ['add tele lan_99 nhé', `add tele ${M.SOCIAL} nhé`],
    ['STK 1903 3445 5667 78', `STK ${M.NUMBER}`],
  ])('%s → %s', (text, masked) => {
    expect(masker.mask(text)).toBe(masked);
  });

  it.each([
    'Mình gặp nhau lúc 7 giờ tối ngày 20/10 nhé',
    'Vé 90k, đi chợ hết 1.200.000 đồng',
    'Em có dùng zalo không?',
    'Tối nay xem Netflix nhé, v.v.',
    'Điểm IELTS em 7.5 đó',
  ])('không có liên hệ → null: %s', (text) => {
    expect(masker.mask(text)).toBeNull();
  });
});

describe('createContentScreener — ghép FraudDetector + ContactMasker', () => {
  const screen = createContentScreener();

  it('tin lừa đảo: gắn cờ + mã luật, che số tài khoản trong bản hiển thị', () => {
    const r = screen(body('Chuyển khoản giúp anh 5 triệu, STK 0123456789 Vietcombank'));
    expect(r.flagged).toBe(true);
    expect(r.reasons).toEqual(['MONEY_TRANSFER', 'BANK_ACCOUNT', 'ACCOUNT_NUMBER', 'MONEY_AMOUNT']);
    expect(r.maskedBody).toBe(`Chuyển khoản giúp anh 5 triệu, STK ${M.PHONE} Vietcombank`);
  });

  it('chỉ chia sẻ SĐT: che nhưng không gắn cờ (reasons rỗng)', () => {
    expect(screen(body('zalo: 0912345678'))).toEqual({
      maskedBody: `zalo: ${M.PHONE}`,
      flagged: false,
      reasons: [],
    });
  });

  it('tin bình thường: không che, không gắn cờ', () => {
    expect(screen(body('Đầu tuần mình đi chuyển nhà'))).toEqual({
      maskedBody: null,
      flagged: false,
      reasons: [],
    });
  });
});
