# Sprint 2 — Identity & Profile

**Mục tiêu sprint:** Người dùng đăng nhập bằng SĐT + OTP, tạo hồ sơ cơ bản, thiết lập tiêu chí bạn đời, upload ảnh.
Admin đăng nhập với mật khẩu + 2FA, có phân quyền và audit log.

**Demo cuối sprint:** Luồng màn 1–4 (Đăng nhập → OTP → Khởi tạo hồ sơ → Tiêu chí) chạy được bằng API; `GET /me` trả đúng bước onboarding.

**Nhóm chạy song song:** (01 → 02) ‖ (03 → 04) ‖ (07) → (05, 06) → (08)

---

### BE-S2-01 · Đăng nhập bằng SĐT + OTP

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| identity | domain, application, infrastructure, presentation | P0 | 2d | Sprint 1 | BE-S2-03, BE-S2-07 | IN_REVIEW |

**Mục tiêu:** Phục vụ màn "Đăng nhập & Đăng ký" và "Xác thực SĐT & OTP".

**Phạm vi**
- Trong: Use case `RequestOtp`, `VerifyOtp`; chuẩn hoá SĐT VN (E.164 +84); OTP 6 số lưu dạng hash, TTL `OTP_TTL_SECONDS`, tối đa `OTP_MAX_ATTEMPTS` lần sai rồi khoá; port `SmsSender` + `ConsoleSmsSender`; port `RateLimiter` + adapter Postgres (theo SĐT và IP: 1 OTP/60s, 5 OTP/giờ); tạo `User` nếu chưa có; route `POST /auth/otp/request`, `POST /auth/otp/verify`.
- Ngoài: Phát token (BE-S2-02), đăng nhập VNeID/Apple/Google (chưa làm).

**Tiêu chí nghiệm thu**
- [x] AC1: OTP đúng trong TTL → thành công, OTP bị vô hiệu sau khi dùng.
- [x] AC2: OTP hết hạn → `OTP_EXPIRED`; sai quá 5 lần → `OTP_LOCKED`.
- [x] AC3: Gọi request liên tục → `RATE_LIMITED` kèm thời gian chờ.
- [x] AC4: OTP và SĐT không xuất hiện trong log.

**Test bắt buộc:** Domain (OtpChallenge), use case với FakeClock, integration rate limit.

**File dự kiến:** `packages/modules/identity/**`, `packages/contracts/src/identity/**`.

**Contract / Event:** DTO auth; mã lỗi `OTP_EXPIRED`, `OTP_INVALID`, `OTP_LOCKED`, `RATE_LIMITED`, `PHONE_INVALID`; event `UserRegistered`.

**Ghi chú:** Liên quan D4.

---

### BE-S2-02 · Phiên đăng nhập: access/refresh token

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| identity | application, infrastructure, presentation | P0 | 1.5d | BE-S2-01 | BE-S2-04 | TODO |

**Mục tiêu:** Xác thực mọi request của app người dùng.

**Phạm vi**
- Trong: Access token JWT 15 phút; refresh token ngẫu nhiên lưu hash, xoay vòng mỗi lần dùng, phát hiện tái sử dụng → thu hồi cả họ token; `POST /auth/refresh`, `POST /auth/logout`; middleware `requireUser()` gắn `userId` vào context; danh sách thiết bị.
- Ngoài: Auth admin (BE-S2-03).

**Tiêu chí nghiệm thu**
- [ ] AC1: Refresh token cũ dùng lại sau khi đã xoay → toàn bộ phiên của thiết bị bị thu hồi.
- [ ] AC2: Route có `requireUser()` trả 401 khi thiếu/hết hạn token.

**Test bắt buộc:** Use case xoay token; HTTP test middleware.

**File dự kiến:** `packages/modules/identity/**`, `apps/api/src/http/auth.ts`.

**Contract / Event:** Mã lỗi `TOKEN_EXPIRED`, `TOKEN_REUSED`, `UNAUTHENTICATED`.

**Ghi chú:** —

---

### BE-S2-03 · Tài khoản admin: mật khẩu + TOTP 2FA + RBAC

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| identity | domain, application, infrastructure, presentation | P0 | 2d | Sprint 1 | BE-S2-01 | TODO |

**Mục tiêu:** Phục vụ màn "Đăng nhập Quản trị" và phân quyền cho cổng vận hành.

**Phạm vi**
- Trong: `AdminUser` (email công vụ, argon2id, role: `REVIEWER`, `MATCHMAKER`, `SUPERVISOR`, `ADMIN`), bắt buộc TOTP; khoá sau 5 lần sai; phiên admin ngắn (8h, tuỳ chọn "ghi nhớ thiết bị 12h"); middleware `requireAdmin(permission)` với bảng permission → role; seed admin đầu tiên qua CLI.
- Ngoài: SSO/USB token.

**Tiêu chí nghiệm thu**
- [ ] AC1: Đúng mật khẩu nhưng thiếu/sai TOTP → không đăng nhập được.
- [ ] AC2: `MATCHMAKER` gọi endpoint duyệt eKYC (permission `kyc:review`) → 403.
- [ ] AC3: Sai 5 lần → khoá 15 phút.

**Test bắt buộc:** Domain + HTTP test phân quyền theo bảng permission.

**File dự kiến:** `packages/modules/identity/**`, `apps/api/src/http/admin-auth.ts`, `tools/seed-admin.ts`.

**Contract / Event:** Mã lỗi `ADMIN_LOCKED`, `MFA_REQUIRED`, `FORBIDDEN`.

**Ghi chú:** Bảng permission đặt ở `identity/domain/permissions.ts` để module khác tham chiếu qua contracts.

---

### BE-S2-04 · Audit log

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| identity | application, infrastructure | P0 | 1d | BE-S2-03 | BE-S2-02 | TODO |

**Mục tiêu:** Ghi vết mọi thao tác nhạy cảm của admin (yêu cầu Nghị định 13 + màn admin "Audit Trail").

**Phạm vi**
- Trong: Port `AuditLogger.log(tx?, {actor, action, targetType, targetId, ip, meta})`; bảng `identity.audit_logs` chỉ ghi thêm (revoke UPDATE/DELETE ở DB role app); export facade cho module khác; query admin xem log (lọc theo actor/target/thời gian, permission `audit:read`).
- Ngoài: Ghi log ở từng use case (mỗi module tự gọi).

**Tiêu chí nghiệm thu**
- [ ] AC1: Role DB của app không thể UPDATE/DELETE `audit_logs` (test integration).
- [ ] AC2: `meta` không được chứa PII thô (validate key cấm).

**Test bắt buộc:** Integration quyền DB; unit validate meta.

**File dự kiến:** `packages/modules/identity/**`.

**Contract / Event:** Migration `identity.audit_logs`.

**Ghi chú:** —

---

### BE-S2-05 · Hồ sơ cơ bản (module mỏng)

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| profile | application, infrastructure, presentation | P0 | 2d | BE-S2-02, BE-S2-07 | BE-S2-06 | TODO |

**Mục tiêu:** Phục vụ màn "Khởi tạo Hồ sơ Miễn phí".

**Phạm vi**
- Trong: Tạo/cập nhật hồ sơ: họ tên, ngày sinh (≥ `MIN_AGE`), giới tính, quê quán, nơi sống, học vấn, nghề nghiệp, tự bạch (≤ 800 ký tự), sở thích (tag); thông tin riêng tư mã hoá (`income_range_enc`, `housing_enc`, `assets_enc`) qua `Encryptor`; ảnh đại diện + tối đa `MAX_PROFILE_PHOTOS` ảnh (tham chiếu key từ BE-S2-07); "Lưu tạm"; `GET/PUT /me/profile`.
- Ngoài: Hiển thị hồ sơ cho người khác (BE-S5-06).

**Tiêu chí nghiệm thu**
- [ ] AC1: Tuổi < `MIN_AGE` → `AGE_NOT_ELIGIBLE`.
- [ ] AC2: Trường riêng tư lưu dạng mã hoá trong DB, trả về đúng cho chính chủ.
- [ ] AC3: Quá 5 ảnh → `TOO_MANY_PHOTOS`.

**Test bắt buộc:** Integration lưu/đọc mã hoá; HTTP validate.

**File dự kiến:** `packages/modules/profile/**`, `packages/contracts/src/profile/**`.

**Contract / Event:** DTO profile; event `ProfileCompleted`.

**Ghi chú:** D6 (`MIN_AGE`).

---

### BE-S2-06 · Tiêu chí bạn đời & bộ lọc cứng

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| profile | application, infrastructure, presentation | P0 | 1d | BE-S2-05 | — | TODO |

**Mục tiêu:** Phục vụ màn "Thiết lập Tiêu chí Bạn đời & Bộ lọc Cứng"; dữ liệu đầu vào cho chấm điểm ghép đôi.

**Phạm vi**
- Trong: Bộ lọc cứng (độ tuổi min/max, khu vực + bán kính, kế hoạch con cái, tôn giáo), lối sống (hút thuốc, rượu bia, nhịp sinh hoạt, thể thao) có mức "không quan trọng", học vấn tối thiểu, độc lập tài chính, đúng 3 phẩm chất cốt lõi; `GET/PUT /me/preferences`.
- Ngoài: Thuật toán chấm điểm (BE-S5-03).

**Tiêu chí nghiệm thu**
- [ ] AC1: Số phẩm chất ≠ 3 → `INVALID_CORE_TRAITS`.
- [ ] AC2: `age_min > age_max` hoặc ngoài [MIN_AGE, 80] → lỗi validate.

**Test bắt buộc:** HTTP validate + integration lưu/đọc.

**File dự kiến:** `packages/modules/profile/**`, `packages/contracts/src/profile/**`.

**Contract / Event:** DTO preferences; event `PreferencesUpdated`.

**Ghi chú:** Lưu theo cấu trúc mà BE-S5-03 có thể lọc bằng SQL (cột riêng cho bộ lọc cứng, jsonb cho phần còn lại).

---

### BE-S2-07 · Upload ảnh qua presigned URL

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| platform (db) | infrastructure, presentation | P0 | 1.5d | Sprint 1 | BE-S2-01, BE-S2-03 | TODO |

**Mục tiêu:** Upload ảnh hồ sơ và tài liệu eKYC mà không đi qua API server.

**Phạm vi**
- Trong: Port `ObjectStorage { presignPut, presignGet, delete, head }` + adapter S3 (MinIO local); `POST /uploads` trả presigned PUT theo `purpose` (`profile_photo` → `public-profile`, `kyc_doc`/`kyc_selfie`/`report_evidence` → `private-kyc`); giới hạn mime (jpeg/png/heic), kích thước; bảng `platform.uploads` (owner, key, purpose, status) để module khác xác nhận quyền sở hữu key; presigned GET TTL `PRESIGNED_URL_TTL_SECONDS`.
- Ngoài: Xử lý ảnh (resize, bỏ EXIF) — ghi vào việc phát sinh.

**Tiêu chí nghiệm thu**
- [ ] AC1: User A không thể dùng key upload của user B trong hồ sơ của mình (`UPLOAD_NOT_OWNED`).
- [ ] AC2: Mime/kích thước sai → từ chối trước khi cấp URL.

**Test bắt buộc:** Integration với MinIO (Testcontainers).

**File dự kiến:** `packages/db/src/storage/**`, `packages/kernel/src/storage.ts` (port), `apps/api/src/http/uploads.ts`.

**Contract / Event:** DTO upload; mã lỗi `UPLOAD_NOT_OWNED`, `UPLOAD_INVALID`.

**Ghi chú:** —

---

### BE-S2-08 · `GET /me` và trạng thái onboarding

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| profile | application, presentation | P1 | 0.5d | BE-S2-05, BE-S2-06 | — | TODO |

**Mục tiêu:** App mobile biết điều hướng người dùng tới màn nào.

**Phạm vi**
- Trong: Query tổng hợp `onboardingStep`: `PROFILE` → `CRITERIA` → `VERIFICATION` → `UNDER_REVIEW` → `ACTIVE` (bước sau lấy qua facade verification/billing; tạm trả `VERIFICATION` khi module chưa có, có TODO rõ ràng); thông tin cơ bản + badge.
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: User mới tạo hồ sơ chưa xong → `PROFILE`; xong hồ sơ + tiêu chí → `VERIFICATION`.

**Test bắt buộc:** HTTP test các bước.

**File dự kiến:** `packages/modules/profile/**`.

**Contract / Event:** DTO `MeResponse`.

**Ghi chú:** Mở rộng ở BE-S3-07 và BE-S4-03.
