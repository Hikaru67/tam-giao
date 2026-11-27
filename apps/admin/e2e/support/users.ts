import { randomInt } from 'node:crypto';
import {
  approveKyc,
  completeProfile,
  fakeIp,
  payVerification,
  randomPhone,
  submitKyc,
  waitActive,
  type AdminSession,
  type FlowConfig,
  type UserSession,
  type UserSpec,
} from '../../../../tests/e2e/src/lib/flow.js';

export interface SeededUser {
  readonly userId: string;
  readonly fullName: string;
  readonly accessToken: string;
}

/** Tạo thông số người dùng ảo với SĐT và IP giả riêng để tránh giới hạn OTP theo IP. */
export function userSpec(gender: 'male' | 'female', fullName: string): UserSpec {
  return {
    gender,
    fullName,
    phone: randomPhone(),
    forwardedFor: fakeIp(1_000 + randomInt(0, 1_000_000)),
  };
}

/** Đưa nhóm người dùng qua đầy đủ bước xác thực tới khi đạt trạng thái `ACTIVE`. */
export async function verifyUsers(
  config: FlowConfig,
  admin: AdminSession,
  users: readonly UserSession[],
): Promise<void> {
  await Promise.all(users.map((user) => completeProfile(user)));
  await Promise.all(users.map((user) => payVerification(config, user)));
  await Promise.all(users.map((user) => submitKyc(user)));
  // Duyệt eKYC tuần tự để tránh tranh chấp phiên/hàng chờ admin.
  for (const user of users) {
    await approveKyc(admin, user);
  }
  await Promise.all(users.map((user) => waitActive(config, user)));
}

export function toSeeded(user: UserSession): SeededUser {
  return {
    userId: user.userId,
    fullName: user.spec.fullName,
    accessToken: user.accessToken,
  };
}
