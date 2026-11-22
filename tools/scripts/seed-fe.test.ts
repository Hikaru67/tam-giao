import { describe, expect, it, vi } from 'vitest';
import {
  formatSummary,
  parseScenario,
  SCENARIOS,
  waitForFreshTotpStep,
  type SummaryData,
} from './seed-fe.js';

describe('parseScenario', () => {
  it('parse thành công mọi kịch bản hợp lệ', () => {
    for (const scenario of SCENARIOS) {
      expect(parseScenario([scenario])).toBe(scenario);
      expect(parseScenario(['node', 'scripts/seed-fe.ts', scenario])).toBe(scenario);
    }
  });

  it('báo lỗi kèm danh sách kịch bản khi kịch bản không hợp lệ', () => {
    expect(() => parseScenario(['invalid-scenario'])).toThrowError(
      /Kịch bản không hợp lệ: "invalid-scenario"\. Danh sách kịch bản hợp lệ: onboarded, verified, offered, dating, date-confirmed/,
    );
  });

  it('báo lỗi kèm danh sách kịch bản khi không truyền tham số', () => {
    expect(() => parseScenario([])).toThrowError(
      /Kịch bản không hợp lệ: ""\. Danh sách kịch bản hợp lệ: onboarded, verified, offered, dating, date-confirmed/,
    );
    expect(() => parseScenario(['node', 'scripts/seed-fe.ts'])).toThrowError(
      /Kịch bản không hợp lệ: ""\. Danh sách kịch bản hợp lệ: onboarded, verified, offered, dating, date-confirmed/,
    );
  });
});

describe('formatSummary', () => {
  it('dựng bảng thông tin kết quả và không chứa access token hoặc secret token', () => {
    const data: SummaryData = {
      scenario: 'onboarded',
      accounts: [
        {
          phone: '0912345678',
          userId: 'user-id-1234',
          status: 'ONBOARDED',
          accessToken: 'SECRET_ACCESS_TOKEN_ABC123',
          refreshToken: 'SECRET_REFRESH_TOKEN_XYZ789',
        },
      ],
      admin: {
        email: 'dev-admin@tamgiao.test',
        password: 'DevAdmin@123456',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/T%C3%A2m%20Giao:dev-admin%40tamgiao.test?secret=JBSWY3DPEHPK3PXP',
        token: 'SECRET_ADMIN_TOKEN_999',
      },
    };

    const formatted = formatSummary(data);

    // Bảng tài khoản
    expect(formatted).toContain('0912345678');
    expect(formatted).toContain('user-id-1234');
    expect(formatted).toContain('ONBOARDED');

    // Admin
    expect(formatted).toContain('dev-admin@tamgiao.test');
    expect(formatted).toContain('DevAdmin@123456');
    expect(formatted).toContain('JBSWY3DPEHPK3PXP');

    // Hướng dẫn OTP
    expect(formatted).toContain('OTP xem ở log api (dòng [sms:dev])');

    // Không bao giờ in token truy cập
    expect(formatted).not.toContain('SECRET_ACCESS_TOKEN_ABC123');
    expect(formatted).not.toContain('SECRET_REFRESH_TOKEN_XYZ789');
    expect(formatted).not.toContain('SECRET_ADMIN_TOKEN_999');
  });
});

describe('waitForFreshTotpStep', () => {
  it('không chờ khi chưa có bước đã dùng hoặc bước hiện tại đã mới hơn', async () => {
    const started = Date.now();
    await waitForFreshTotpStep(null);
    await waitForFreshTotpStep(Math.floor(Date.now() / 30_000) - 1);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('chờ sang cửa sổ TOTP kế tiếp khi bước hiện tại vừa được dùng', async () => {
    vi.useFakeTimers();
    try {
      const nowMs = 1_000_000 * 30_000 + 29_000; // còn 1s tới bước kế
      const pending = waitForFreshTotpStep(1_000_000, () => nowMs);
      let done = false;
      void pending.then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(600);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
