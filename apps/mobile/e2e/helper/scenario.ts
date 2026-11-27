import { randomInt, randomUUID } from 'node:crypto';
import { ChatClient } from '../../../../tests/e2e/src/lib/chat.js';
import { signedFakeWebhook } from '../../../../tests/e2e/src/lib/crypto.js';
import {
  adminLogin,
  approveKyc,
  completeProfile,
  fakeIp,
  payVerification,
  proposeMatch,
  randomPhone,
  registerUsers,
  runTag,
  submitKyc,
  uploadImage,
  waitActive,
  waitConversation,
  type AdminSession,
  type UserSession,
  type UserSpec,
} from '../../../../tests/e2e/src/lib/flow.js';
import { sleep, waitFor } from '../../../../tests/e2e/src/lib/http.js';
import { extractOtps, waitForOtps } from '../../../../tests/e2e/src/lib/otp.js';
import type { HelperConfig } from './config.js';
import type { HelperStep, HelperStepOutput } from './steps.js';

interface RunState {
  readonly tag: string;
  readonly admin: AdminSession;
  readonly a: UserSession;
  readonly b: UserSession;
  readonly partnerId: string;
  readonly otpLogOffset: number;
  readonly uiLoginNotBefore: number;
  matchId?: string;
  conversationId?: string;
  datePlanId?: string;
  dateStartsAt?: Date;
}

interface PaymentItem {
  readonly orderId: string;
  readonly amountVnd: number;
  readonly status: string;
}

interface CurrentDatePlanView {
  readonly datePlan: {
    readonly id: string;
    readonly inviterId: string;
    readonly status: string;
  } | null;
}

type StepHandlers = { [K in HelperStep]: () => Promise<HelperStepOutput<K>> };

/** Điều phối các bước phía BE/đối phương (B, chuyên viên, quán) cho luồng Maestro của A. */
export class MobileE2eScenario {
  private state: RunState | undefined;

  private readonly handlers: StepHandlers = {
    start: () => this.start(),
    'otp-window': () => this.otpWindow(),
    otp: () => this.otp(),
    pay: () => this.pay(),
    approve: () => this.approve(),
    'counterpart-accept': () => this.counterpartAccept(),
    'counterpart-message': () => this.counterpartMessage(),
    'date-repropose': () => this.dateRepropose(),
    'wait-date-start': () => this.waitDateStart(),
    'counterpart-feedback': () => this.counterpartFeedback(),
  };

  constructor(private readonly config: HelperConfig) {}

  async run<S extends HelperStep>(step: S): Promise<HelperStepOutput<S>> {
    const handler = this.handlers[step] as () => Promise<HelperStepOutput<S>>;
    return handler();
  }

  private requireState(): RunState {
    if (this.state === undefined) throw new Error('chưa chạy bước start');
    return this.state;
  }

  private async start(): Promise<HelperStepOutput<'start'>> {
    this.state = undefined;
    const tag = runTag();
    const { api } = this.config.flow;
    const admin = await adminLogin(api, this.config.admin);

    // Đăng ký trước A để lấy phiên điền sẵn 1 ảnh nháp (tránh picker ảnh hệ thống trong emulator).
    const forwardedForA = fakeIp(1_000 + randomInt(0, 50_000));
    const specA: UserSpec = {
      fullName: `E2E Mobile Nam ${tag}`,
      gender: 'male',
      phone: randomPhone(),
      forwardedFor: forwardedForA,
    };
    const httpA = api.withHeaders({ 'x-forwarded-for': forwardedForA });
    const requestedAt = Date.now();
    const otpReq = await httpA.post<{ readonly resendAfterSeconds: number }>('/auth/otp/request', {
      phone: specA.phone,
    });
    const codes = await waitForOtps(this.config.flow.otp, [specA.phone]);
    const code = codes.get(specA.phone);
    if (code === undefined) throw new Error('không đọc được OTP khi đăng ký trước A');

    const verify = await httpA.post<{
      readonly userId: string;
      readonly tokens: { readonly accessToken: string; readonly refreshToken: string };
    }>('/auth/otp/verify', {
      phone: specA.phone,
      code,
      deviceName: 'e2e',
    });
    // Ghi mốc độ dài log để bước `otp` chỉ đọc OTP mới phát sinh khi UI đăng nhập.
    const otpLogOffset = (await this.config.flow.otp()).length;
    const uiLoginNotBefore = requestedAt + (otpReq.resendAfterSeconds + 3) * 1_000;
    const a: UserSession = {
      spec: specA,
      userId: verify.userId,
      accessToken: verify.tokens.accessToken,
      refreshToken: verify.tokens.refreshToken,
      http: httpA,
    };

    const photoKey = await uploadImage(a, 'profile_photo');
    await a.http.put('/me/profile', { photos: [photoKey], submit: false }, { token: a.accessToken });

    // Seed đầy đủ đối phương B (nữ) tới trạng thái ACTIVE.
    const specB: UserSpec = {
      fullName: `E2E Mobile Nu ${tag}`,
      gender: 'female',
      phone: randomPhone(),
      forwardedFor: fakeIp(60_000 + randomInt(0, 50_000)),
    };
    const [b] = await registerUsers(this.config.flow, [specB]);
    if (b === undefined) throw new Error('không tạo được phiên người dùng B');
    await completeProfile(b);
    await payVerification(this.config.flow, b);
    await submitKyc(b);
    await approveKyc(admin, b);
    await waitActive(this.config.flow, b);

    const partner = await api.post<{ readonly id: string }>(
      '/admin/partners',
      { name: `Quan E2E Mobile ${tag}`, address: '1 Trang Tien, Ha Noi', tags: ['e2e'] },
      { token: admin.token, expect: 201 },
    );

    this.state = {
      tag,
      admin,
      a,
      b,
      partnerId: partner.id,
      otpLogOffset,
      uiLoginNotBefore,
    };
    return { phone: specA.phone, fullName: specA.fullName, partnerId: partner.id };
  }

  private async otpWindow(): Promise<HelperStepOutput<'otp-window'>> {
    const state = this.requireState();
    const waitMs = state.uiLoginNotBefore - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    return {};
  }

  private async otp(): Promise<HelperStepOutput<'otp'>> {
    const state = this.requireState();
    const tail = state.a.spec.phone.replace(/\D/g, '').slice(-9);
    const { value: otp } = await waitFor(
      'OTP mới của A',
      async () => {
        const logs = await this.config.flow.otp();
        return extractOtps(logs.slice(state.otpLogOffset)).get(tail);
      },
      { timeoutMs: 30_000 },
    );
    return { otp };
  }

  private async pay(): Promise<HelperStepOutput<'pay'>> {
    const state = this.requireState();
    const { a } = state;
    const { api, webhookSecret, paymentGateway, eventTimeoutMs } = this.config.flow;

    const { value: pending } = await waitFor(
      'khoản PENDING do app tạo',
      async () => {
        const history = await a.http.get<{ readonly items: readonly PaymentItem[] }>('/me/payments', {
          token: a.accessToken,
        });
        const latest = history.items[0];
        return latest !== undefined && latest.status === 'PENDING' ? latest : undefined;
      },
      { timeoutMs: 30_000 },
    );

    if (webhookSecret !== undefined) {
      const webhook = signedFakeWebhook(webhookSecret, {
        orderId: pending.orderId,
        amountVnd: pending.amountVnd,
        gatewayTxnId: `e2e_mobile_${randomUUID()}`,
      });
      const ack = await api.post<{ readonly outcome: string }>(
        `/webhooks/payments/${paymentGateway}`,
        webhook.rawBody,
        { headers: webhook.headers },
      );
      if (ack.outcome !== 'SUCCEEDED') {
        throw new Error(`webhook thanh toán không được áp dụng: ${ack.outcome}`);
      }
    } else {
      await api.post(`/dev/payments/fake/${pending.orderId}`, { outcome: 'SUCCEEDED' });
    }

    await waitFor(
      'khoản thanh toán SUCCEEDED',
      async () => {
        const history = await a.http.get<{ readonly items: readonly PaymentItem[] }>('/me/payments', {
          token: a.accessToken,
        });
        const matched = history.items.find((item) => item.orderId === pending.orderId);
        return matched?.status === 'SUCCEEDED' ? true : undefined;
      },
      { timeoutMs: eventTimeoutMs },
    );
    return {};
  }

  private async approve(): Promise<HelperStepOutput<'approve'>> {
    const state = this.requireState();
    await approveKyc(state.admin, state.a);
    await waitActive(this.config.flow, state.a);
    const match = await proposeMatch(this.config.flow, state.admin, state.a, state.b);
    state.matchId = match.matchId;
    return {};
  }

  private async counterpartAccept(): Promise<HelperStepOutput<'counterpart-accept'>> {
    const state = this.requireState();
    const res = await state.b.http.post<{ readonly status: string }>(
      '/me/match/accept',
      {},
      { token: state.b.accessToken },
    );
    if (res.status !== 'DATING') {
      throw new Error(`trạng thái sau khi B đồng ý: ${res.status}`);
    }
    const conversationId = await waitConversation(this.config.flow, state.b, state.a.userId);
    state.conversationId = conversationId;
    return { conversationId };
  }

  private async counterpartMessage(): Promise<HelperStepOutput<'counterpart-message'>> {
    const state = this.requireState();
    const cid = state.conversationId;
    if (cid === undefined) throw new Error('chưa có conversationId (cần chạy counterpart-accept trước)');

    await waitFor(
      'B thấy tin của A',
      async () => {
        const history = await state.b.http.get<{ readonly items: readonly unknown[] }>(
          `/me/conversations/${cid}/messages`,
          { token: state.b.accessToken },
        );
        return history.items.length >= 1 ? true : undefined;
      },
      { timeoutMs: this.config.flow.eventTimeoutMs },
    );

    const replyText = `E2E reply ${state.tag}`;
    const ws = await ChatClient.connect(this.config.baseUrl, state.b.accessToken);
    try {
      await ws.join(cid);
      await ws.sendMessage(cid, replyText);
    } finally {
      ws.close();
    }
    return { replyText };
  }

  private async dateRepropose(): Promise<HelperStepOutput<'date-repropose'>> {
    const state = this.requireState();
    const current = await state.b.http.get<CurrentDatePlanView>('/me/dates/current', {
      token: state.b.accessToken,
    });
    const plan = current.datePlan;
    if (plan === null) throw new Error('chưa có lịch hẹn hiện tại để B từ chối');
    if (plan.status !== 'PROPOSED') {
      throw new Error(`lịch hẹn hiện tại có trạng thái ${plan.status}, cần PROPOSED`);
    }
    if (plan.inviterId.toLowerCase() !== state.a.userId.toLowerCase()) {
      throw new Error('lịch hẹn hiện tại không phải do A mời');
    }

    await state.b.http.post(`/me/dates/${plan.id}/decline`, {}, { token: state.b.accessToken });

    // B đề xuất lịch gần hiện tại để A xác nhận và có thể mở đánh giá ngay sau `wait-date-start`.
    const startsAt = new Date(Date.now() + this.config.dateLeadSeconds * 1_000);
    const endsAt = new Date(startsAt.getTime() + 2 * 3_600_000);
    const created = await state.b.http.post<{ readonly id: string }>(
      '/me/dates',
      {
        partnerId: state.partnerId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        staffBookingRequested: false,
      },
      { token: state.b.accessToken, expect: 201 },
    );
    state.datePlanId = created.id;
    state.dateStartsAt = startsAt;
    return {};
  }

  private async waitDateStart(): Promise<HelperStepOutput<'wait-date-start'>> {
    const state = this.requireState();
    if (state.dateStartsAt === undefined) {
      throw new Error('chưa có thời gian bắt đầu buổi hẹn (cần chạy date-repropose trước)');
    }
    const waitMs = state.dateStartsAt.getTime() + 2_000 - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    return {};
  }

  private async counterpartFeedback(): Promise<HelperStepOutput<'counterpart-feedback'>> {
    const state = this.requireState();
    if (state.datePlanId === undefined) {
      throw new Error('chưa có datePlanId (cần chạy date-repropose trước)');
    }
    if (state.matchId === undefined) {
      throw new Error('chưa có matchId (cần chạy approve trước)');
    }
    const { datePlanId, matchId } = state;

    await state.b.http.post(
      `/me/dates/${datePlanId}/feedback`,
      {
        rating: 5,
        profileMatch: 'FULL_MATCH',
        feeling: 'DEEP_INTEREST',
        decision: 'A_COMMIT',
        stopReasons: [],
        stopNote: null,
      },
      { token: state.b.accessToken, expect: 201 },
    );

    await waitFor(
      'match CLOSED_SUCCESS',
      async () => {
        const board = await state.admin.http.get<{ readonly items: readonly { readonly matchId: string }[] }>(
          '/admin/matches?status=CLOSED_SUCCESS&limit=100',
          { token: state.admin.token },
        );
        return board.items.some((m) => m.matchId === matchId) ? true : undefined;
      },
      { timeoutMs: this.config.flow.eventTimeoutMs },
    );
    return {};
  }
}
