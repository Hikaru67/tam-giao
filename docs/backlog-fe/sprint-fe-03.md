# Sprint FE-03 — Xác thực (mobile) + Thẩm định (admin)

**Mục tiêu sprint:** Mobile: trả phí xác thực, nộp eKYC, đặt phỏng vấn, theo dõi thẩm định. Admin: đăng nhập 2FA, thẩm
định eKYC, quản lý slot phỏng vấn.

**Demo cuối sprint:** User trả phí (cổng giả) → nộp CCCD + selfie → đặt slot phỏng vấn; chuyên viên đăng nhập 2FA →
nhận hồ sơ → duyệt → app user chuyển "đã duyệt", voucher có hạn dùng.

**Nhóm chạy song song:** Mobile (01 → 02 → 03, 04) ‖ Admin (05 → 06, 07, 08)

---

### FE-S3-01 · Thanh toán phí xác thực

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 1.5d | FE-S2-02 | FE-S3-05 | DONE |

**Mục tiêu:** Phần thanh toán trong màn `x_c_th_c_ekyc_m_kh_a_h_s_t_ng_h_p_b_o_ch_ng_100`.

**Phạm vi**
- Trong: hiển thị số tiền `DEPOSIT_VND`, voucher `VOUCHER_VND`, điều kiện hoàn tiền (`REFUND_SLA_HOURS`);
  `POST /me/payments/verification` → mở `checkoutUrl` (expo-web-browser) → quay lại app (deep link) → poll
  `GET /me/payments` tới khi `SUCCEEDED`/`FAILED`; dev: nút "thanh toán giả" gọi `/dev/payments/fake/:orderId` khi `__DEV__`.
- Ngoài: Tích hợp SDK cổng thật (D3).

**Tiêu chí nghiệm thu**
- [ ] AC1: Đóng trình duyệt giữa chừng → app vẫn hiện đúng trạng thái sau khi poll.
- [ ] AC2: Nút thanh toán giả không có trong bản build production.

**Test bắt buộc:** Hook poll với MSW (PENDING → SUCCEEDED, FAILED, timeout).

**File dự kiến:** `apps/mobile/app/(verification)/payment*`, `apps/mobile/src/features/payment/**`.

**Contract / Event:** Không có.

**Ghi chú:** FE-D5 + D1: tên gọi "ký quỹ"/"phí dịch vụ" chờ pháp lý — dùng chữ trung tính "phí xác thực" tới khi chốt.

---

### FE-S3-02 · Nộp eKYC: chụp CCCD + selfie

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 2d | FE-S3-01 | FE-S3-06 | DONE |

**Mục tiêu:** Phần eKYC của màn `x_c_th_c_ekyc_…`.

**Phạm vi**
- Trong: hướng dẫn chụp; camera (expo-camera) mặt trước/sau CCCD + selfie; kiểm tra cơ bản (đủ sáng, không mờ — nếu
  khả thi); upload presigned (không lưu ảnh vào thư viện, xoá file tạm sau upload — luật F5); `POST /me/kyc`; trạng thái
  `GET /me/kyc`; lỗi `PAYMENT_REQUIRED`, `KYC_ALREADY_SUBMITTED`, yêu cầu bổ sung từ chuyên viên.
- Ngoài: NFC/liveness của nhà cung cấp thật (D2).

**Tiêu chí nghiệm thu**
- [ ] AC1: Ảnh CCCD/selfie không còn trên máy sau khi nộp xong.
- [ ] AC2: Chuyên viên "yêu cầu bổ sung" → app hiện lý do và cho chụp lại đúng ảnh được yêu cầu.

**Test bắt buộc:** Luồng nộp với MSW; kiểm tra xoá file tạm (mock FileSystem).

**File dự kiến:** `apps/mobile/app/(verification)/kyc*`, `apps/mobile/src/features/kyc/**`.

**Contract / Event:** Không có.

**Ghi chú:** FE-D5: bỏ khẳng định "NFC chuẩn Bộ Công An", "VNeID".

---

### FE-S3-03 · Đặt lịch phỏng vấn sơ bộ

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 1d | FE-S3-02 | FE-S3-04, FE-S3-07 | TODO |

**Mục tiêu:** User chọn slot phỏng vấn với chuyên viên (BE-S3-05).

**Phạm vi**
- Trong: `GET /me/kyc/interview/slots` (lịch theo ngày, giờ địa phương), `POST /me/kyc/interview`, xem lịch đã đặt
  `GET /me/kyc/interview`, huỷ/đổi `DELETE` (chặn khi còn < `INTERVIEW_CHANGE_CUTOFF_HOURS`), slot vừa bị người khác lấy → làm mới.
- Ngoài: Gọi video (ngoài phạm vi).

**Tiêu chí nghiệm thu**
- [ ] AC1: Trong vòng cutoff → nút huỷ/đổi bị khoá kèm giải thích.

**Test bắt buộc:** MSW: đặt, slot hết, huỷ trong cutoff.

**File dự kiến:** `apps/mobile/app/(verification)/interview*`, `apps/mobile/src/features/interview/**`.

**Contract / Event:** Không có.

**Ghi chú:** Chưa có thiết kế (FE-D4).

---

### FE-S3-04 · Hồ sơ đang thẩm định + voucher + hoàn tiền

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 1d | FE-S3-02 | FE-S3-03, FE-S3-08 | TODO |

**Mục tiêu:** Màn `h_s_ang_th_m_nh_h_ng_ch_1_1`.

**Phạm vi**
- Trong: các bước thẩm định theo `GET /me/kyc` (bước, trạng thái); voucher `GET /me/vouchers` (RESERVED/ACTIVE, hạn
  `VOUCHER_TTL_DAYS`); bị từ chối → lý do (nếu BE trả) + trạng thái hoàn tiền (`GET /me/payments`); kéo để làm mới + cập nhật khi nhận push `KycApproved/Rejected`.
- Ngoài: QR voucher (FE-S5-02).

**Tiêu chí nghiệm thu**
- [ ] AC1: Push "đã duyệt" khi đang mở màn → màn tự cập nhật.

**Test bắt buộc:** Render theo từng trạng thái KYC/payment.

**File dự kiến:** `apps/mobile/app/(verification)/status*`, `apps/mobile/src/features/kyc/**`.

**Contract / Event:** Không có.

**Ghi chú:** FE-D5: bỏ "Bảo chứng 100%", "VNeID/UBND"; quán dùng voucher lấy từ `GET /partners`, không hardcode.

---

### FE-S3-05 · Admin: đăng nhập email + mật khẩu + TOTP, khung điều hướng

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| admin | presentation | P0 | 1.5d | FE-S1-03, FE-S1-07 | FE-S3-01 | DONE |

**Mục tiêu:** Màn `ng_nh_p_qu_n_tr_i_u_ph_i_mai_m_i` + khung (sidebar, header) theo `web_admin_th_m_nh…`.

**Phạm vi**
- Trong: `POST /admin/auth/login` (email, mật khẩu, mã TOTP, "ghi nhớ thiết bị"), `GET /admin/auth/me` (role,
  permission), `POST /admin/auth/logout`; lỗi khoá 15 phút; ẩn/hiện menu theo permission; 401 → về đăng nhập, 403 → màn "không đủ quyền".
- Ngoài: Quản lý tài khoản admin (seed bằng tool BE).

**Tiêu chí nghiệm thu**
- [x] AC1: Role không có `kyc:review` không thấy menu thẩm định và vào URL trực tiếp thì thấy màn 403.

**Test bắt buộc:** Bảng permission → menu; MSW đăng nhập sai/khoá.

**File dự kiến:** `apps/admin/src/routes/login*`, `apps/admin/src/layout/**`, `apps/admin/src/features/auth/**`.

**Contract / Event:** Không có.

**Ghi chú:** FE-D6: bỏ thống kê header/"Mã ca trực" tới khi BE có `/admin/dashboard`.

---

### FE-S3-06 · Admin: thẩm định eKYC

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| admin | presentation | P0 | 2.5d | FE-S3-05 | FE-S3-02 | DONE |

**Mục tiêu:** Màn `web_admin_th_m_nh_ekyc_gh_p_i_c_quy_n` (hàng chờ + panel chi tiết + thanh quyết định).

**Phạm vi**
- Trong: hàng chờ `GET /admin/kyc/submissions` (lọc, phân trang cursor); chi tiết `GET /admin/kyc/submissions/:id` (ảnh
  presigned ≤ 5 phút, tự xin lại khi hết hạn, không cache — luật F5); nhận hồ sơ `assign`; đánh dấu bước `steps`;
  `approve` / `reject` (lý do) / `request-more-info`; xung đột (người khác đã nhận) → thông báo + tải lại.
- Ngoài: Thống kê dashboard (FE-D6).

**Tiêu chí nghiệm thu**
- [ ] AC1: Ảnh không còn hiển thị được sau khi URL hết hạn nếu không xin lại (không có bản cache).
- [ ] AC2: Từ chối bắt buộc nhập lý do.

**Test bắt buộc:** MSW cho hàng chờ, chi tiết, từng quyết định, xung đột assign.

**File dự kiến:** `apps/admin/src/routes/kyc/**`, `apps/admin/src/features/kyc/**`.

**Contract / Event:** Không có.

**Ghi chú:** Mỗi lần mở chi tiết, BE đã ghi audit — FE không cần gọi thêm.

---

### FE-S3-07 · Admin: slot phỏng vấn + ghi chú

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| admin | presentation | P1 | 1d | FE-S3-05 | FE-S3-03 | DONE |

**Mục tiêu:** Chuyên viên mở slot và ghi nhận xét phỏng vấn.

**Phạm vi**
- Trong: lịch tuần `GET /admin/kyc/interview/slots`, tạo slot `POST` (thời lượng `INTERVIEW_DURATION_MINUTES`), ghi chú
  `PUT /admin/kyc/interview/:id/notes`.
- Ngoài: —

**Tiêu chí nghiệm thu**
- [x] AC1: Slot đã có người đặt hiển thị khác slot trống.

**Test bắt buộc:** MSW tạo slot, ghi chú.

**File dự kiến:** `apps/admin/src/routes/interviews/**`, `apps/admin/src/features/interviews/**`.

**Contract / Event:** Không có.

**Ghi chú:** Chưa có thiết kế (FE-D4).

---

### FE-S3-08 · Admin: nhật ký audit

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| admin | presentation | P1 | 0.5d | FE-S3-05 | FE-S3-04 | DONE |

**Mục tiêu:** Xem ai đã đọc dữ liệu nhạy cảm (permission `audit:read`).

**Phạm vi**
- Trong: `GET /admin/audit-logs` lọc actor/target/thời gian, phân trang cursor.
- Ngoài: Xuất file.

**Tiêu chí nghiệm thu**
- [x] AC1: Query sai → hiện lỗi `VALIDATION_FAILED` đúng trường lọc.

**Test bắt buộc:** MSW lọc + phân trang.

**File dự kiến:** `apps/admin/src/routes/audit/**`.

**Contract / Event:** Không có.

**Ghi chú:** Chưa có thiết kế (FE-D4).
