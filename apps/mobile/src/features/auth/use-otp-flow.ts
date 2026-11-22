import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import {
  requestOtpResponseSchema,
  verifyOtpResponseSchema,
  type RequestOtpBody,
  type RequestOtpResponse,
  type VerifyOtpBody,
} from '@tamgiao/contracts/identity';
import { useMutation } from '@tanstack/react-query';
import { useTokenStore } from '../../session/token-store-context.js';

export interface OtpErrorView {
  message: string;
  action?: string | undefined;
  lockInput: boolean;
  banned: boolean;
}

/**
 * Chuyển đổi lỗi từ API thành thông điệp tiếng Việt và trạng thái giao diện tương ứng.
 */
export function otpErrorView(error: unknown): OtpErrorView {
  if (isApiError(error)) {
    const info = messageFor(error);
    const code = error.code;
    const meta = error.meta as { remainingAttempts?: number; retryAfterSeconds?: number } | undefined;
    const lockInput = code === 'OTP_LOCKED' || (code === 'OTP_INVALID' && meta?.remainingAttempts === 0);
    const banned = code === 'ACCOUNT_BANNED';

    return {
      message: info.title,
      action: info.action,
      lockInput,
      banned,
    };
  }

  const networkInfo = messageFor({ code: 'NETWORK_ERROR' });
  return {
    message: networkInfo.title,
    action: networkInfo.action,
    lockInput: false,
    banned: false,
  };
}

/**
 * Hook gửi yêu cầu cấp mã OTP qua SMS.
 */
export function useRequestOtp() {
  const client = useApiClient();

  return useMutation({
    mutationFn: async (body: RequestOtpBody): Promise<RequestOtpResponse> => {
      return client.post('/auth/otp/request', {
        body: { phone: body.phone },
        schema: requestOtpResponseSchema,
        auth: false,
      });
    },
  });
}

export interface VerifyOtpResult {
  userId: string;
  isNewUser: boolean;
}

/**
 * Hook xác thực mã OTP, lưu tokens phiên vào secure token store và trả về kết quả.
 * Tuân thủ quy định: không có expo-device thì bỏ trường deviceName; KHÔNG lưu SĐT vào storage.
 */
export function useVerifyOtp() {
  const client = useApiClient();
  const tokenStore = useTokenStore();

  return useMutation({
    mutationFn: async (body: VerifyOtpBody): Promise<VerifyOtpResult> => {
      const payload: VerifyOtpBody = {
        phone: body.phone,
        code: body.code,
      };

      const result = await client.post('/auth/otp/verify', {
        body: payload,
        schema: verifyOtpResponseSchema,
        auth: false,
      });

      await tokenStore.setTokens(result.tokens);

      return {
        userId: result.userId,
        isNewUser: result.isNewUser,
      };
    },
  });
}
