import { NOTIFICATION_CATEGORY_NAMES, NOTIFICATION_KIND_NAMES } from '@tamgiao/contracts';
import { describe, expect, it } from 'vitest';
import {
  ALWAYS_ON_CATEGORIES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_KINDS,
  isCategoryEnabled,
  isNotificationKind,
  reminderTime,
  smsTextFor,
  templateFor,
} from '../domain/templates.js';

describe('template thông báo', () => {
  it('loại + nhóm khớp contracts (FE dùng `data.kind` để điều hướng)', () => {
    expect([...NOTIFICATION_KINDS]).toEqual([...NOTIFICATION_KIND_NAMES]);
    expect([...NOTIFICATION_CATEGORIES]).toEqual([...NOTIFICATION_CATEGORY_NAMES]);
  });

  it('mọi loại có tiêu đề + nội dung tiếng Việt, không còn placeholder', () => {
    for (const kind of NOTIFICATION_KINDS) {
      const t = templateFor(kind);
      expect(t.kind).toBe(kind);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
      expect(`${t.title} ${t.body}`).not.toMatch(/\{|\}|undefined|NaN/);
    }
  });

  it('số giờ/ngày lấy từ hằng số nghiệp vụ', () => {
    expect(templateFor('MATCH_OFFERED').body).toContain('24 giờ');
    expect(templateFor('MATCH_OFFER_EXPIRING').body).toContain('Còn 2 giờ');
    expect(templateFor('MATCH_STARTED_DATING').body).toContain('14 ngày');
    expect(templateFor('DATE_REMINDER').body).toContain('2 giờ');
    expect(templateFor('KYC_REJECTED').body).toContain('48 giờ');
  });

  it('chỉ thông báo giao dịch (ACCOUNT) có SMS thay thế', () => {
    for (const kind of NOTIFICATION_KINDS) {
      const t = templateFor(kind);
      expect(t.smsFallback).toBe(t.category === 'ACCOUNT');
    }
    expect(smsTextFor(templateFor('REFUND_COMPLETED'))).toBe(
      'Tam Giao: Đã hoàn tiền. Phí xác thực đã được hoàn lại cho bạn.',
    );
  });

  it('isNotificationKind', () => {
    expect(isNotificationKind('MATCH_OFFERED')).toBe(true);
    expect(isNotificationKind('EMAIL')).toBe(false);
  });
});

describe('cài đặt nhận thông báo', () => {
  it('mặc định bật hết', () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(isCategoryEnabled(c, DEFAULT_NOTIFICATION_PREFERENCES)).toBe(true);
    }
  });

  it('tắt được MATCH/MESSAGE/DATE; ACCOUNT và SAFETY luôn bật', () => {
    const off = { matches: false, messages: false, dates: false };
    expect(isCategoryEnabled('MATCH', off)).toBe(false);
    expect(isCategoryEnabled('MESSAGE', off)).toBe(false);
    expect(isCategoryEnabled('DATE', off)).toBe(false);
    expect(isCategoryEnabled('ACCOUNT', off)).toBe(true);
    expect(isCategoryEnabled('SAFETY', off)).toBe(true);
    expect(ALWAYS_ON_CATEGORIES).toEqual(['ACCOUNT', 'SAFETY']);
    expect(isCategoryEnabled('MESSAGE', { ...off, messages: true })).toBe(true);
  });
});

describe('reminderTime', () => {
  const now = new Date('2026-06-01T08:00:00.000Z');

  it('nhắc trước hạn n giờ', () => {
    expect(reminderTime(new Date('2026-06-02T08:00:00.000Z'), 2, now)).toEqual(
      new Date('2026-06-02T06:00:00.000Z'),
    );
  });

  it('mốc nhắc đã qua hoặc đúng bằng hiện tại → null', () => {
    expect(reminderTime(new Date('2026-06-01T10:00:00.000Z'), 2, now)).toBeNull();
    expect(reminderTime(new Date('2026-06-01T09:00:00.000Z'), 2, now)).toBeNull();
  });
});
