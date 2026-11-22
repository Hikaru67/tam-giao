# Sprint FE-02 — Mobile: đăng nhập & hồ sơ

**Mục tiêu sprint:** Người dùng đăng nhập bằng OTP, tạo hồ sơ có ảnh, đặt tiêu chí bạn đời, bật thông báo; quản lý
tài khoản và quyền dữ liệu.

**Demo cuối sprint:** Trên BE local: nhập SĐT → OTP (log SMS giả) → tạo hồ sơ + 3 ảnh → tiêu chí → nhận push thử; vào cài
đặt → yêu cầu xuất dữ liệu, xoá tài khoản bằng OTP.

**Nhóm chạy song song:** (01) → (02) → (03, 04, 05, 06)

---

### FE-S2-01 · Đăng nhập / đăng ký bằng SĐT + OTP

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 1.5d | FE-S1-03, FE-S1-07 | — | DONE |

**Mục tiêu:** Màn `ng_nh_p_ng_k` + `x_c_th_c_s_i_n_tho_i_otp`.

**Phạm vi**
- Trong: nhập SĐT (chuẩn hoá +84), `POST /auth/otp/request`, màn OTP 6 số, đếm ngược gửi lại theo `OTP_TTL_SECONDS`,
  `POST /auth/otp/verify` (kèm tên thiết bị), lưu token SecureStore; xử lý `PHONE_INVALID`, `OTP_INVALID`,
  `OTP_EXPIRED`, `OTP_LOCKED`, `RATE_LIMITED`, `ACCOUNT_BANNED`; tự điền OTP (iOS one-time-code / Android SMS Retriever nếu khả thi).
- Ngoài: Điều hướng sau đăng nhập (FE-S2-02).

**Tiêu chí nghiệm thu**
- [ ] AC1: OTP sai 5 lần → thông điệp khoá + không cho nhập tiếp.
- [ ] AC2: `ACCOUNT_BANNED` → màn thông báo tài khoản bị khoá, không lưu token.
- [ ] AC3: SĐT không xuất hiện trong log/analytics.

**Test bắt buộc:** Render màn với MSW cho từng mã lỗi; hook đếm ngược.

**File dự kiến:** `apps/mobile/app/(auth)/**`, `apps/mobile/src/features/auth/**`.

**Contract / Event:** Không có.

**Ghi chú:** FE-D5: bỏ các câu "VNeID/Bộ Công An" nếu thiết kế có.

---

### FE-S2-02 · Điều hướng theo trạng thái onboarding + đăng xuất

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 1d | FE-S2-01 | — | DONE |

**Mục tiêu:** Mở app là vào đúng màn theo tiến độ (`GET /me`): hồ sơ → tiêu chí → thanh toán → eKYC → chờ duyệt → ghép.

**Phạm vi**
- Trong: guard Expo Router đọc `GET /me` (trạng thái onboarding); splash; đăng xuất (`POST /auth/logout`); sự kiện "đăng
  xuất" từ api-client → về màn đăng nhập; quản lý thiết bị đăng nhập (`GET /auth/sessions`, `DELETE /auth/sessions/:id`) — P2.
- Ngoài: Nội dung các màn đích.

**Tiêu chí nghiệm thu**
- [ ] AC1: Mỗi trạng thái onboarding dẫn tới đúng một màn (test theo bảng).
- [ ] AC2: Refresh token hết hạn khi đang dùng → về màn đăng nhập, không mất dữ liệu nhập dở ở màn hồ sơ (giữ trong bộ nhớ).

**Test bắt buộc:** Unit bảng trạng thái → route.

**File dự kiến:** `apps/mobile/app/_layout.tsx`, `apps/mobile/src/features/session/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S2-03 · Khởi tạo hồ sơ + ảnh

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 2d | FE-S2-02 | FE-S2-04, FE-S2-05, FE-S2-06 | TODO |

**Mục tiêu:** Màn `kh_i_t_o_h_s_mi_n_ph`.

**Phạm vi**
- Trong: form theo `GET/PUT /me/profile` (tên gọi, ngày sinh — kiểm `MIN_AGE`, giới tính, thành phố, nghề, học vấn, tự
  bạch, sở thích…; trường nhạy cảm thu nhập/nhà ở/tài sản ghi rõ "chỉ chuyên viên thấy"); chọn/chụp ảnh, nén, upload
  presigned, tối đa `MAX_PROFILE_PHOTOS`, sắp xếp/xoá; lưu nháp trong bộ nhớ; validate bằng schema contracts.
- Ngoài: eKYC (FE-S3-02).

**Tiêu chí nghiệm thu**
- [ ] AC1: Ảnh thứ `MAX_PROFILE_PHOTOS + 1` bị chặn ở client trước khi upload.
- [ ] AC2: Lỗi validate từ BE (`VALIDATION_FAILED` + đường dẫn trường) hiện đúng dưới trường.

**Test bắt buộc:** Form validate; upload với MSW (thành công, URL hết hạn → xin lại).

**File dự kiến:** `apps/mobile/app/(onboarding)/profile*`, `apps/mobile/src/features/profile/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S2-04 · Tiêu chí bạn đời

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 1d | FE-S2-02 | FE-S2-03, FE-S2-05, FE-S2-06 | TODO |

**Mục tiêu:** Màn `thi_t_l_p_ti_u_ch_b_n_i_b_l_c_c_ng`.

**Phạm vi**
- Trong: `GET/PUT /me/preferences` (độ tuổi, khu vực, học vấn, quan điểm…); slider khoảng tuổi; lưu.
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: Giá trị lưu xong đọc lại hiển thị đúng.

**Test bắt buộc:** Render + lưu với MSW.

**File dự kiến:** `apps/mobile/app/(onboarding)/preferences*`, `apps/mobile/src/features/preferences/**`.

**Contract / Event:** Không có.

**Ghi chú:** Thiết kế ghi "bộ lọc cứng" — kiểm tra với PO những tiêu chí nào BE thật sự dùng để lọc.

---

### FE-S2-05 · Push notification + cài đặt nhận thông báo

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | infrastructure, presentation | P0 | 1.5d | FE-S2-02 | FE-S2-03, FE-S2-04, FE-S2-06 | TODO |

**Mục tiêu:** Người dùng nhận được gợi ý 24h, phản hồi, lịch hẹn, cảnh báo (BE-S7-05).

**Phạm vi**
- Trong: xin quyền push, lấy Expo push token, `POST /me/devices` (đăng ký lại khi token đổi), `DELETE /me/devices/:id`
  khi đăng xuất; mở thông báo → điều hướng theo `data.kind` + id (`matchId`, `conversationId`, `datePlanId`, `reportId`);
  màn cài đặt `GET/PUT /me/notification-settings` (MATCH/MESSAGE/DATE bật tắt; ACCOUNT/SAFETY luôn bật).
- Ngoài: Hộp thông báo lịch sử (FE-D6, chờ BE).

**Tiêu chí nghiệm thu**
- [ ] AC1: Mọi `NOTIFICATION_KIND_NAMES` trong contracts có route đích (test bảng).
- [ ] AC2: Đăng xuất → thiết bị bị gỡ khỏi BE.

**Test bắt buộc:** Unit bảng kind → route; MSW đăng ký thiết bị.

**File dự kiến:** `apps/mobile/src/features/notifications/**`, `apps/mobile/app/settings/notifications*`.

**Contract / Event:** Không có.

**Ghi chú:** Màn cài đặt chưa có thiết kế (FE-D4). Cần project EAS + credentials push (FE-S6-05).

---

### FE-S2-06 · Cài đặt tài khoản: xuất dữ liệu & xoá tài khoản

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 1d | FE-S2-02 | FE-S2-03, FE-S2-04, FE-S2-05 | TODO |

**Mục tiêu:** Quyền chủ thể dữ liệu theo NĐ 13 (BE-S7-06) có trên app.

**Phạm vi**
- Trong: `POST /me/data-exports` + theo dõi `GET /me/data-exports/:id` → mở link tải (24h); xoá tài khoản: cảnh báo hệ
  quả (đóng match, không hoàn phí xác thực — quyết định PO), `POST /me/account/deletion/otp` → nhập OTP →
  `POST /me/account/deletion` → màn tiến độ `GET /account-deletions/:requestId` → đăng xuất.
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: Màn xác nhận xoá nêu rõ không hoàn phí xác thực.
- [ ] AC2: Xoá xong → token bị xoá khỏi máy, về màn đăng nhập.

**Test bắt buộc:** Luồng xoá với MSW (OTP sai, thành công).

**File dự kiến:** `apps/mobile/app/settings/**`, `apps/mobile/src/features/data-rights/**`.

**Contract / Event:** Không có.

**Ghi chú:** Chưa có thiết kế (FE-D4).
