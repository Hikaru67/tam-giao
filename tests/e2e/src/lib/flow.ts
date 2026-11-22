import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { signedFakeWebhook, totp } from './crypto.js';
import type { ApiClient } from './http.js';
import { waitFor } from './http.js';
import { waitForOtps, type OtpSource } from './otp.js';

/**
 * Các bước nghiệp vụ dùng chung giữa e2e toàn luồng (`full-flow.ts`) và seed dữ liệu tải (`seed-load.ts`).
 * Mọi bước đi qua HTTP công khai của API; chỉ OTP đọc từ log SMS giả (xem `otp.ts`).
 */

export interface Gender {
  readonly gender: 'male' | 'female';
}

export interface UserSpec extends Gender {
  /** Họ tên duy nhất mỗi lần chạy — chuyên viên tìm hồ sơ eKYC theo tên (`?q=`). */
  readonly fullName: string;
  readonly phone: string;
  /** IP giả cho `x-forwarded-for` (chỉ có tác dụng khi API bật `TRUST_PROXY=true`) — tránh hạn mức OTP theo IP. */
  readonly forwardedFor?: string | undefined;
}

export interface UserSession {
  readonly spec: UserSpec;
  readonly userId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly http: ApiClient;
}

export interface AdminSession {
  readonly token: string;
  readonly http: ApiClient;
}

export interface FlowConfig {
  readonly api: ApiClient;
  readonly otp: OtpSource;
  /** `PAYMENT_WEBHOOK_SECRET` → tự ký webhook gửi `POST /webhooks/payments/:gateway`; thiếu → dùng `/dev/payments/fake`. */
  readonly webhookSecret?: string | undefined;
  readonly paymentGateway: string;
  /** Thời gian chờ tối đa cho bước phụ thuộc worker (outbox → consumer). */
  readonly eventTimeoutMs: number;
}

/** SĐT di động VN ngẫu nhiên (đầu 09, không có thật) — mỗi lần chạy một bộ số mới. */
export function randomPhone(): string {
  return `09${randomInt(0, 100_000_000).toString().padStart(8, '0')}`;
}

/** IP riêng (10.x.y.z) cho người dùng ảo thứ `index`. */
export function fakeIp(index: number): string {
  return `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;
}

export const runTag = (): string => randomBytes(3).toString('hex');

// ——— Đăng ký / đăng nhập OTP ———

interface VerifyOtpResponse {
  readonly userId: string;
  readonly tokens: { readonly accessToken: string; readonly refreshToken: string };
}

/** Yêu cầu OTP cho cả nhóm → đọc log SMS giả một lần → xác thực từng người. */
export async function registerUsers(config: FlowConfig, specs: readonly UserSpec[]): Promise<UserSession[]> {
  const clientOf = (spec: UserSpec) =>
    spec.forwardedFor === undefined
      ? config.api
      : config.api.withHeaders({ 'x-forwarded-for': spec.forwardedFor });
  await Promise.all(specs.map((spec) => clientOf(spec).post('/auth/otp/request', { phone: spec.phone })));
  const codes = await waitForOtps(
    config.otp,
    specs.map((s) => s.phone),
  );
  return Promise.all(
    specs.map(async (spec) => {
      const http = clientOf(spec);
      const verified = await http.post<VerifyOtpResponse>('/auth/otp/verify', {
        phone: spec.phone,
        code: codes.get(spec.phone),
        deviceName: 'e2e',
      });
      return {
        spec,
        userId: verified.userId,
        accessToken: verified.tokens.accessToken,
        refreshToken: verified.tokens.refreshToken,
        http,
      };
    }),
  );
}

// ——— Upload ảnh qua presigned URL ———

type UploadPurpose = 'profile_photo' | 'kyc_doc' | 'kyc_selfie';

interface UploadTicket {
  readonly key: string;
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** "Ảnh" JPEG giả (header SOI/APP0 + byte ngẫu nhiên) — storage chỉ kiểm content-type và kích thước. */
function fakeJpeg(): Buffer {
  return Buffer.concat([
    Buffer.from('ffd8ffe000104a46494600', 'hex'),
    randomBytes(512),
    Buffer.from('ffd9', 'hex'),
  ]);
}

export async function uploadImage(user: UserSession, purpose: UploadPurpose): Promise<string> {
  const bytes = fakeJpeg();
  const ticket = await user.http.post<UploadTicket>(
    '/uploads',
    { purpose, contentType: 'image/jpeg', sizeBytes: bytes.length },
    { token: user.accessToken, expect: 201 },
  );
  // Kiểu DOM `BodyInit` (jsdom trong workspace) chỉ nhận Uint8Array dựa trên ArrayBuffer.
  const res = await fetch(ticket.url, {
    method: 'PUT',
    headers: ticket.headers,
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`PUT presigned (${purpose}) → ${res.status}`);
  return ticket.key;
}

// ——— Hồ sơ + tiêu chí ———

/** Hồ sơ đầy đủ (`submit: true`) — hai người cùng thành phố, khác giới, tuổi 28–32 để qua bộ lọc cứng của nhau. */
export async function completeProfile(user: UserSession): Promise<void> {
  const photo = await uploadImage(user, 'profile_photo');
  const male = user.spec.gender === 'male';
  await user.http.put(
    '/me/profile',
    {
      fullName: user.spec.fullName,
      birthDate: male ? '1994-03-15' : '1996-08-20',
      gender: user.spec.gender,
      hometown: 'Hà Nội',
      currentCity: 'Hà Nội',
      education: 'bachelor',
      occupation: male ? 'Kỹ sư phần mềm' : 'Giáo viên',
      religion: 'none',
      childrenPlan: 'want_children',
      bio: 'Hồ sơ kiểm thử tự động (BE-S7-09).',
      interests: ['đọc sách', 'du lịch'],
      incomeRange: '20m_40m',
      housing: 'renting',
      photos: [photo],
      submit: true,
    },
    { token: user.accessToken },
  );
  await user.http.put(
    '/me/preferences',
    {
      ageMin: 22,
      ageMax: 45,
      area: { city: 'Hà Nội', radiusKm: null },
      childrenPlan: 'not_important',
      religion: 'not_important',
      lifestyle: {
        smoking: 'not_important',
        drinking: 'not_important',
        dailyRhythm: 'not_important',
        sports: 'not_important',
      },
      minEducation: null,
      financialIndependence: 'not_important',
      coreTraits: ['honest', 'kind', 'responsible'],
    },
    { token: user.accessToken },
  );
}

// ——— Thanh toán xác thực (cổng giả + webhook ký) ———

interface CheckoutResponse {
  readonly paymentId: string;
  readonly orderId: string;
  readonly amountVnd: number;
}

interface MeResponse {
  readonly onboardingStep: string;
  readonly verificationPaid: boolean;
}

export async function payVerification(config: FlowConfig, user: UserSession): Promise<CheckoutResponse> {
  const checkout = await user.http.post<CheckoutResponse>(
    '/me/payments/verification',
    {},
    { token: user.accessToken, headers: { 'idempotency-key': randomUUID() } },
  );
  if (config.webhookSecret !== undefined) {
    const webhook = signedFakeWebhook(config.webhookSecret, {
      orderId: checkout.orderId,
      amountVnd: checkout.amountVnd,
      gatewayTxnId: `e2e_txn_${randomUUID()}`,
    });
    const ack = await config.api.post<{ outcome: string }>(
      `/webhooks/payments/${config.paymentGateway}`,
      webhook.rawBody,
      {
        headers: webhook.headers,
      },
    );
    if (ack.outcome !== 'SUCCEEDED') throw new Error(`webhook thanh toán không được áp dụng: ${ack.outcome}`);
  } else {
    await config.api.post(`/dev/payments/fake/${checkout.orderId}`, { outcome: 'SUCCEEDED' });
  }
  const me = await user.http.get<MeResponse>('/me', { token: user.accessToken });
  if (!me.verificationPaid) throw new Error('GET /me: verificationPaid vẫn false sau webhook');
  return checkout;
}

// ——— eKYC (Fake provider) ———

export async function submitKyc(user: UserSession): Promise<{ status: string }> {
  const [cccdFrontKey, cccdBackKey, maritalStatusCertificateKey, selfieKey] = await Promise.all([
    uploadImage(user, 'kyc_doc'),
    uploadImage(user, 'kyc_doc'),
    uploadImage(user, 'kyc_doc'),
    uploadImage(user, 'kyc_selfie'),
  ]);
  return user.http.post<{ status: string }>(
    '/me/kyc',
    { cccdFrontKey, cccdBackKey, selfieKey, maritalStatusCertificateKey },
    { token: user.accessToken, expect: 201 },
  );
}

// ——— Chuyên viên (admin) ———

export interface AdminCredentials {
  readonly email: string;
  readonly password: string;
  readonly totpSecret: string;
}

export async function adminLogin(api: ApiClient, creds: AdminCredentials): Promise<AdminSession> {
  const res = await api.post<{ token: string }>('/admin/auth/login', {
    email: creds.email,
    password: creds.password,
    totpCode: totp(creds.totpSecret),
  });
  return { token: res.token, http: api };
}

interface KycQueueResponse {
  readonly items: readonly { readonly id: string; readonly userId: string; readonly status: string }[];
}

/** Tìm hồ sơ eKYC của `user` theo tên → nhận hồ sơ → đánh dấu đạt 4 bước → duyệt. */
export async function approveKyc(admin: AdminSession, user: UserSession): Promise<string> {
  const q = encodeURIComponent(user.spec.fullName);
  const queue = await admin.http.get<KycQueueResponse>(`/admin/kyc/submissions?q=${q}&limit=50`, {
    token: admin.token,
  });
  const submission = queue.items.find((s) => s.userId === user.userId);
  if (submission === undefined) throw new Error('không thấy hồ sơ eKYC trong hàng chờ admin');
  const base = `/admin/kyc/submissions/${submission.id}`;
  await admin.http.post(`${base}/assign`, {}, { token: admin.token });
  for (const step of ['CCCD_CHIP', 'MARITAL_STATUS', 'MANUAL_REVIEW', 'INTERVIEW']) {
    await admin.http.post(`${base}/steps`, { step, outcome: 'PASSED' }, { token: admin.token });
  }
  await admin.http.post(`${base}/approve`, {}, { token: admin.token });
  return submission.id;
}

/** Chờ `GET /me` báo `ACTIVE` (facade verification đọc trạng thái hồ sơ đã duyệt). */
export async function waitActive(config: FlowConfig, user: UserSession): Promise<void> {
  await waitFor(
    'onboardingStep ACTIVE',
    async () => {
      const me = await user.http.get<MeResponse>('/me', { token: user.accessToken });
      return me.onboardingStep === 'ACTIVE' ? true : undefined;
    },
    { timeoutMs: config.eventTimeoutMs },
  );
}

/** Đề xuất ghép đôi — chờ read model ứng viên (worker tiêu thụ event hồ sơ/tiêu chí) sẵn sàng. */
export async function proposeMatch(
  config: FlowConfig,
  admin: AdminSession,
  a: UserSession,
  b: UserSession,
): Promise<{ matchId: string; status: string }> {
  const { value } = await waitFor(
    'POST /admin/matches',
    () =>
      admin.http.post<{ matchId: string; status: string }>(
        '/admin/matches',
        { userAId: a.userId, userBId: b.userId, staffNote: 'e2e BE-S7-09' },
        { token: admin.token, expect: 201 },
      ),
    { timeoutMs: config.eventTimeoutMs, intervalMs: 1_000 },
  );
  return value;
}

// ——— Ghép đôi: hai phía đồng ý → DATING, hội thoại mở ———

interface MatchView {
  readonly match: { readonly matchId: string; readonly status: string } | null;
}

export async function matchStatus(user: UserSession): Promise<string | null> {
  const res = await user.http.get<MatchView>('/me/match', { token: user.accessToken });
  return res.match?.status ?? null;
}

export async function acceptBoth(a: UserSession, b: UserSession): Promise<string> {
  await a.http.post('/me/match/accept', {}, { token: a.accessToken });
  const res = await b.http.post<{ status: string }>('/me/match/accept', {}, { token: b.accessToken });
  return res.status;
}

interface ConversationList {
  readonly items: readonly {
    readonly conversationId: string;
    readonly peerUserId: string;
    readonly status?: string;
  }[];
}

/** Chờ hội thoại của cặp được mở (messaging tiêu thụ event match `DATING`). */
export async function waitConversation(
  config: FlowConfig,
  user: UserSession,
  peerId: string,
): Promise<string> {
  const { value } = await waitFor(
    'hội thoại được mở',
    async () => {
      const list = await user.http.get<ConversationList>('/me/conversations', { token: user.accessToken });
      return list.items.find((c) => c.peerUserId === peerId)?.conversationId;
    },
    { timeoutMs: config.eventTimeoutMs },
  );
  return value;
}
