import { z } from 'zod';

/**
 * DTO quán đối tác + nhân viên quán (BE-S4-06). Quán chỉ "tắt" (`active: false`), không xoá — lịch hẹn/voucher cũ
 * vẫn tham chiếu được.
 */

export const PARTNER_NAME_MAX_LENGTH = 120;
export const PARTNER_ADDRESS_MAX_LENGTH = 300;
export const PARTNER_TAG_MAX_LENGTH = 30;
export const PARTNER_TAGS_MAX = 10;
/** PIN nhân viên quán: đúng 6 chữ số (domain giữ bản sao, test giữ khớp). */
export const PARTNER_PIN_PATTERN = /^\d{6}$/;

const name = z.string().trim().min(1).max(PARTNER_NAME_MAX_LENGTH);
const address = z.string().trim().min(1).max(PARTNER_ADDRESS_MAX_LENGTH);
const tags = z.array(z.string().trim().min(1).max(PARTNER_TAG_MAX_LENGTH)).max(PARTNER_TAGS_MAX);
/** Ảnh quán: URL https công khai (ảnh giới thiệu, không phải dữ liệu cá nhân). */
const photoUrl = z.url({ protocol: /^https$/ }).max(2048);
const pin = z.string().regex(PARTNER_PIN_PATTERN);
/** Định danh thiết bị do app/web của quán sinh và lưu cục bộ. */
const deviceId = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const staffName = z.string().trim().min(1).max(PARTNER_NAME_MAX_LENGTH);

const nonEmpty = (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined);

// ── Người dùng app ────────────────────────────────────────────────────────────────────────────────

/** Quán hiển thị cho người dùng (màn đặt hẹn). */
export const partnerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string(),
  photoUrl: z.string().nullable(),
  tags: z.array(z.string()),
});
export type PartnerDto = z.infer<typeof partnerSchema>;

/** `GET /partners` — chỉ quán đang `active`, sắp theo tên. */
export const partnerListResponseSchema = z.object({ items: z.array(partnerSchema) });
export type PartnerListResponse = z.infer<typeof partnerListResponseSchema>;

// ── Admin (permission `partner:manage`) ───────────────────────────────────────────────────────────

/** `POST /admin/partners`. */
export const createPartnerBodySchema = z.object({
  name,
  address,
  photoUrl: photoUrl.nullable().optional(),
  tags: tags.default([]),
});
export type CreatePartnerBody = z.infer<typeof createPartnerBodySchema>;

/** `PATCH /admin/partners/:id` — chỉ gửi trường cần đổi; `photoUrl: null` = gỡ ảnh; `active: false` = tắt quán. */
export const updatePartnerBodySchema = z
  .object({
    name: name.optional(),
    address: address.optional(),
    photoUrl: photoUrl.nullable().optional(),
    tags: tags.optional(),
    active: z.boolean().optional(),
  })
  .refine(nonEmpty, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdatePartnerBody = z.infer<typeof updatePartnerBodySchema>;

/** `GET /admin/partners?active=true|false` — bỏ trống = tất cả. */
export const adminPartnersQuerySchema = z.object({
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type AdminPartnersQuery = z.infer<typeof adminPartnersQuerySchema>;

export const adminPartnerSchema = partnerSchema.extend({
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminPartner = z.infer<typeof adminPartnerSchema>;
export const adminPartnerListResponseSchema = z.object({ items: z.array(adminPartnerSchema) });
export type AdminPartnerListResponse = z.infer<typeof adminPartnerListResponseSchema>;

/**
 * `POST /admin/partners/:id/staff` — tạo tài khoản nhân viên quán. `deviceId` bỏ trống = gắn thiết bị ở lần đăng nhập
 * thành công đầu tiên.
 */
export const createPartnerStaffBodySchema = z.object({
  name: staffName,
  pin,
  deviceId: deviceId.nullable().optional(),
});
export type CreatePartnerStaffBody = z.infer<typeof createPartnerStaffBodySchema>;

/**
 * `PATCH /admin/partners/:id/staff/:staffId` — đổi tên / đặt lại PIN (mở khoá) / đổi hoặc gỡ thiết bị (`null`) /
 * vô hiệu hoá. Đổi PIN hoặc thiết bị thu hồi mọi token partner đã cấp.
 */
export const updatePartnerStaffBodySchema = z
  .object({
    name: staffName.optional(),
    pin: pin.optional(),
    deviceId: deviceId.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(nonEmpty, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdatePartnerStaffBody = z.infer<typeof updatePartnerStaffBodySchema>;

/** Tài khoản nhân viên quán cho admin — không bao giờ có PIN/hash. */
export const adminPartnerStaffSchema = z.object({
  id: z.uuid(),
  partnerId: z.uuid(),
  name: z.string(),
  deviceId: z.string().nullable(),
  active: z.boolean(),
  lockedUntil: z.iso.datetime().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminPartnerStaff = z.infer<typeof adminPartnerStaffSchema>;
export const adminPartnerStaffListResponseSchema = z.object({ items: z.array(adminPartnerStaffSchema) });
export type AdminPartnerStaffListResponse = z.infer<typeof adminPartnerStaffListResponseSchema>;

// ── Nhân viên quán (partner web) ──────────────────────────────────────────────────────────────────

/** `POST /partner/auth/login`. */
export const partnerLoginBodySchema = z.object({ staffId: z.uuid(), pin, deviceId });
export type PartnerLoginBody = z.infer<typeof partnerLoginBodySchema>;

const partnerIdentity = {
  staff: z.object({ id: z.uuid(), name: z.string() }),
  partner: z.object({ id: z.uuid(), name: z.string() }),
};

/** Phản hồi đăng nhập: token partner ngắn hạn gửi kèm `Authorization: Bearer <token>`. */
export const partnerSessionResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
  ...partnerIdentity,
});
export type PartnerSessionResponse = z.infer<typeof partnerSessionResponseSchema>;

/** `GET /partner/auth/me`. */
export const partnerMeResponseSchema = z.object(partnerIdentity);
export type PartnerMeResponse = z.infer<typeof partnerMeResponseSchema>;
