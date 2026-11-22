/**
 * E2E toàn luồng (BE-S7-09): 2 người dùng (A nam, B nữ) + 1 chuyên viên, mọi bước qua HTTP/WS công khai của API,
 * mọi nhà cung cấp là Fake (SMS console, eKYC fake, cổng thanh toán fake).
 *
 *   OTP → hồ sơ + tiêu chí → thanh toán (webhook ký) → eKYC → chuyên viên duyệt → chuyên viên ghép → hai phía đồng ý
 *   → chat (WS) → đặt lịch tại quán + xác nhận (voucher ACTIVE) → quán quét voucher → hai bên đánh giá A_COMMIT
 *   → match CLOSED_SUCCESS.
 *
 * Lưu ý thứ tự: API chặn nộp eKYC khi chưa thanh toán (`PAYMENT_REQUIRED`, BE-S4-03) nên bước thanh toán đứng trước
 * bước nộp eKYC; chuyên viên duyệt sau khi hồ sơ đã nộp.
 *
 * Chạy: `pnpm --filter @tamgiao/e2e e2e` (local: `tests/e2e/run-local.sh e2e`). Biến môi trường — xem tests/e2e/README.md.
 * Thoát mã 0 khi mọi bước PASS, 1 khi có bước FAIL. Không in SĐT/OTP/token/nội dung chat (AGENTS.md mục 5).
 */
import { pathToFileURL } from 'node:url';
import { ChatClient } from './lib/chat.js';
import {
  acceptBoth,
  adminLogin,
  approveKyc,
  completeProfile,
  fakeIp,
  matchStatus,
  payVerification,
  proposeMatch,
  randomPhone,
  registerUsers,
  runTag,
  submitKyc,
  waitActive,
  waitConversation,
  type AdminCredentials,
  type FlowConfig,
  type UserSession,
} from './lib/flow.js';
import { ApiClient, HttpError, sleep, waitFor } from './lib/http.js';
import { otpSourceFromEnv } from './lib/otp.js';

export interface StepResult {
  readonly name: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly detail?: string;
}

const out = (line: string): void => void process.stdout.write(`${line}\n`);

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`thiếu biến môi trường ${name}`);
  return value;
}

export async function runFullFlow(env: NodeJS.ProcessEnv): Promise<readonly StepResult[]> {
  const baseUrl = env.E2E_BASE_URL ?? 'http://localhost:3100';
  const api = new ApiClient(baseUrl);
  const config: FlowConfig = {
    api,
    otp: otpSourceFromEnv(env),
    webhookSecret: env.E2E_WEBHOOK_SECRET || undefined,
    paymentGateway: env.E2E_PAYMENT_GATEWAY ?? 'fake',
    eventTimeoutMs: Number(env.E2E_EVENT_TIMEOUT_MS ?? 30_000),
  };
  const adminCreds: AdminCredentials = {
    email: required(env, 'E2E_ADMIN_EMAIL'),
    password: required(env, 'E2E_ADMIN_PASSWORD'),
    totpSecret: required(env, 'E2E_ADMIN_TOTP_SECRET'),
  };
  const useForwardedFor = env.E2E_FORWARDED_FOR === 'true';
  const dateLeadSeconds = Number(env.E2E_DATE_LEAD_SECONDS ?? 20);

  const results: StepResult[] = [];
  const step = async <T>(name: string, run: () => Promise<T>, detail?: (v: T) => string): Promise<T> => {
    const startedAt = performance.now();
    try {
      const value = await run();
      const ms = Math.round(performance.now() - startedAt);
      const extra = detail?.(value);
      results.push({ name, ok: true, ms, ...(extra ? { detail: extra } : {}) });
      out(`PASS ${name} (${ms} ms)${extra ? ` — ${extra}` : ''}`);
      return value;
    } catch (error) {
      const ms = Math.round(performance.now() - startedAt);
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name, ok: false, ms, detail: message });
      out(`FAIL ${name} (${ms} ms) — ${message}`);
      if (error instanceof HttpError && typeof error.body === 'object') {
        // Problem+json không chứa PII (chỉ code/title/meta) — in để chẩn đoán.
        out(`     ${JSON.stringify(error.body)}`);
      }
      throw error;
    }
  };

  const tag = runTag();
  try {
    await step('0. API sẵn sàng (GET /ready)', () => api.get('/ready'));

    // 1. Đăng ký OTP (Fake SMS).
    const [a, b] = (await step('1. Đăng ký OTP 2 người dùng', () =>
      registerUsers(config, [
        {
          fullName: `E2E Nam ${tag}`,
          gender: 'male',
          phone: randomPhone(),
          forwardedFor: useForwardedFor ? fakeIp(1_000 + Math.floor(Math.random() * 50_000)) : undefined,
        },
        {
          fullName: `E2E Nu ${tag}`,
          gender: 'female',
          phone: randomPhone(),
          forwardedFor: useForwardedFor ? fakeIp(60_000 + Math.floor(Math.random() * 50_000)) : undefined,
        },
      ]),
    )) as [UserSession, UserSession];

    // 2. Hồ sơ + tiêu chí.
    await step('2. Hồ sơ (ảnh presigned) + tiêu chí', () =>
      Promise.all([completeProfile(a), completeProfile(b)]),
    );

    // 3. Thanh toán xác thực: cổng giả + webhook ký.
    await step(
      '3. Thanh toán xác thực (webhook ký)',
      () => Promise.all([payVerification(config, a), payVerification(config, b)]),
      ([p]) => `${p.amountVnd} VND/người, ${config.webhookSecret ? 'webhook tự ký' : '/dev/payments/fake'}`,
    );

    // 4. eKYC (Fake provider).
    await step(
      '4. Nộp eKYC (4 ảnh, FakeEkycProvider)',
      () => Promise.all([submitKyc(a), submitKyc(b)]),
      ([k]) => `status ${k.status}`,
    );

    // 5. Chuyên viên đăng nhập (mật khẩu + TOTP) và duyệt hồ sơ.
    const admin = await step('5a. Chuyên viên đăng nhập (TOTP)', () => adminLogin(api, adminCreds));
    await step('5b. Chuyên viên duyệt eKYC 2 hồ sơ', async () => {
      await approveKyc(admin, a);
      await approveKyc(admin, b);
    });
    await step('5c. GET /me → ACTIVE (cả hai)', () =>
      Promise.all([waitActive(config, a), waitActive(config, b)]),
    );

    // Quán đối tác + nhân viên quán (dữ liệu nền cho bước đặt lịch / quét voucher).
    const partner = await step('6. Tạo quán đối tác + nhân viên, nhân viên đăng nhập PIN', async () => {
      const created = await api.post<{ id: string }>(
        '/admin/partners',
        { name: `Quán E2E ${tag}`, address: '1 Tràng Tiền, Hà Nội', tags: ['e2e'] },
        { token: admin.token, expect: 201 },
      );
      const pin = '246810';
      const deviceId = `e2e-device-${tag}`;
      const staff = await api.post<{ id: string }>(
        `/admin/partners/${created.id}/staff`,
        { name: 'Nhân viên E2E', pin, deviceId },
        { token: admin.token, expect: 201 },
      );
      const session = await api.post<{ token: string }>('/partner/auth/login', {
        staffId: staff.id,
        pin,
        deviceId,
      });
      return { id: created.id, staffToken: session.token };
    });

    // 7. Chuyên viên ghép đôi.
    const proposal = await step(
      '7. Chuyên viên đề xuất ghép A–B',
      () => proposeMatch(config, admin, a, b),
      (m) => `match ${m.status}`,
    );

    // 8. Hai phía đồng ý → DATING.
    await step(
      '8. Hai phía đồng ý → DATING',
      async () => {
        const status = await acceptBoth(a, b);
        if (status !== 'DATING') throw new Error(`trạng thái sau khi B đồng ý: ${status}`);
        const seenByA = await matchStatus(a);
        if (seenByA !== 'DATING') throw new Error(`GET /me/match của A: ${seenByA}`);
        return status;
      },
      (s) => s,
    );

    // 9. Chat realtime qua WebSocket.
    const conversationId = await step('9a. Hội thoại được mở (GET /me/conversations)', () =>
      waitConversation(config, a, b.userId),
    );
    await step('9b. Chat WS: A gửi → B nhận, B trả lời → A nhận', async () => {
      const [wsA, wsB] = await Promise.all([
        ChatClient.connect(baseUrl, a.accessToken),
        ChatClient.connect(baseUrl, b.accessToken),
      ]);
      try {
        await Promise.all([wsA.join(conversationId), wsB.join(conversationId)]);
        const ackA = await wsA.sendMessage(conversationId, 'Chào bạn, rất vui được làm quen!');
        await wsB.next((e) => e.type === 'message.new');
        const ackB = await wsB.sendMessage(conversationId, 'Chào anh, em cũng vậy.');
        await wsA.next((e) => e.type === 'message.new');
        if (ackA.duplicate !== false || ackB.duplicate !== false) throw new Error('ack báo trùng tin');
        const history = await b.http.get<{ items: unknown[] }>(
          `/me/conversations/${conversationId}/messages`,
          {
            token: b.accessToken,
          },
        );
        if (history.items.length < 2) throw new Error(`lịch sử có ${history.items.length} tin, cần ≥ 2`);
      } finally {
        wsA.close();
        wsB.close();
      }
    });

    // 10. Đặt lịch tại quán (A mời) + B xác nhận → voucher của A ACTIVE.
    const startsAt = new Date(Date.now() + dateLeadSeconds * 1_000);
    const datePlan = await step(
      '10a. A đề xuất lịch tại quán, B xác nhận',
      async () => {
        const plan = await a.http.post<{ id: string }>(
          '/me/dates',
          {
            partnerId: partner.id,
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startsAt.getTime() + 2 * 3_600_000).toISOString(),
          },
          { token: a.accessToken, expect: 201 },
        );
        const confirmed = await b.http.post<{ id: string; status: string }>(
          `/me/dates/${plan.id}/confirm`,
          {},
          { token: b.accessToken },
        );
        if (confirmed.status !== 'CONFIRMED') throw new Error(`lịch sau xác nhận: ${confirmed.status}`);
        return confirmed;
      },
      (p) => p.status,
    );
    const voucher = await step(
      '10b. Voucher của người mời → ACTIVE',
      async () =>
        (
          await waitFor(
            'voucher ACTIVE',
            async () => {
              const list = await a.http.get<{ items: { id: string; status: string; valueVnd: number }[] }>(
                '/me/vouchers',
                { token: a.accessToken },
              );
              return list.items.find((v) => v.status === 'ACTIVE');
            },
            { timeoutMs: config.eventTimeoutMs },
          )
        ).value,
      (v) => `${v.valueVnd} VND`,
    );

    // 11. Quán quét QR voucher.
    await step(
      '11. Nhân viên quán quét QR voucher → REDEEMED',
      async () => {
        const qr = await a.http.get<{ token: string }>(`/me/vouchers/${voucher.id}/qr`, {
          token: a.accessToken,
        });
        const redeemed = await api.post<{ status: string }>(
          '/partner/vouchers/redeem',
          { token: qr.token },
          { token: partner.staffToken },
        );
        if (redeemed.status !== 'REDEEMED') throw new Error(`redeem: ${redeemed.status}`);
        const again = await api.request('POST', '/partner/vouchers/redeem', {
          body: { token: qr.token },
          token: partner.staffToken,
          expect: [409, 422],
        });
        return again.status;
      },
      (s) => `quét lần 2 → ${s}`,
    );

    // 12. Đánh giá sau buổi gặp (chỉ được gửi khi đã tới giờ bắt đầu).
    const waitMs = startsAt.getTime() - Date.now() + 1_000;
    if (waitMs > 0) await sleep(waitMs);
    const feedback = {
      rating: 5,
      profileMatch: 'FULL_MATCH',
      feeling: 'DEEP_INTEREST',
      decision: 'A_COMMIT',
      stopReasons: [],
      stopNote: null,
    };
    await step('12. Hai bên đánh giá A_COMMIT', async () => {
      await a.http.post(`/me/dates/${datePlan.id}/feedback`, feedback, { token: a.accessToken, expect: 201 });
      await b.http.post(`/me/dates/${datePlan.id}/feedback`, feedback, { token: b.accessToken, expect: 201 });
    });

    // 13. Match đóng thành công (matching tiêu thụ FeedbackSubmitted).
    await step(
      '13. Match → CLOSED_SUCCESS',
      async () =>
        (
          await waitFor(
            'match CLOSED_SUCCESS',
            async () => {
              const board = await api.get<{ items: { matchId: string; status: string }[] }>(
                '/admin/matches?status=CLOSED_SUCCESS&limit=100',
                { token: admin.token },
              );
              return board.items.find((m) => m.matchId === proposal.matchId)?.status;
            },
            { timeoutMs: config.eventTimeoutMs },
          )
        ).value,
      (s) => s,
    );
  } catch {
    // Bước lỗi đã được ghi vào `results`.
  }
  return results;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  let results: readonly StepResult[];
  try {
    results = await runFullFlow(process.env);
  } catch (error) {
    out(`FAIL cấu hình — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const failed = results.filter((r) => !r.ok);
  out(
    `\n${failed.length === 0 ? 'E2E PASS' : 'E2E FAIL'}: ${results.length - failed.length}/${results.length} bước, ` +
      `${((Date.now() - startedAt) / 1_000).toFixed(1)} s`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) await main();
