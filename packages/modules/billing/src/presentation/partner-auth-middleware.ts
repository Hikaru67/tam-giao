import { bearerToken, problemResponse, type AppEnv } from '@tamgiao/http';
import { domainError } from '@tamgiao/kernel';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type {
  AuthenticatePartnerStaff,
  PartnerStaffAuth,
} from '../application/partner/authenticate-partner-staff.js';

/** Env Hono cho route của nhân viên quán: thêm `c.get('partnerStaff')` sau `requirePartnerStaff`. */
export interface PartnerEnv {
  Variables: AppEnv['Variables'] & { partnerStaff: PartnerStaffAuth };
}

/**
 * Guard route nhân viên quán (vd `POST /partner/vouchers/redeem` ở BE-S4-05): `Authorization: Bearer <token partner>`.
 * Thiếu/sai/hết hạn/bị thu hồi → 401 `PARTNER_TOKEN_INVALID`; quán đã tắt hoặc tài khoản bị vô hiệu hoá → 403
 * `PARTNER_INACTIVE`. Kiểm tra lại DB mỗi request (không tin token sau khi quán bị tắt).
 */
export const createRequirePartnerStaff = (authenticate: AuthenticatePartnerStaff) =>
  createMiddleware<PartnerEnv>(async (c, next) => {
    // `PartnerEnv` chỉ thêm biến vào `AppEnv` → dùng được helper Problem JSON viết cho `Context<AppEnv>`.
    const base = c as unknown as Context<AppEnv>;
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return problemResponse(base, domainError('PARTNER_TOKEN_INVALID'));
    const auth = await authenticate.execute(token);
    if (auth.isErr()) return problemResponse(base, auth.error);
    c.set('partnerStaff', auth.value);
    return next();
  });

export type RequirePartnerStaff = ReturnType<typeof createRequirePartnerStaff>;
