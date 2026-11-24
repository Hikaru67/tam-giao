# Sprint FE-05 — Hẹn hò & Partner

**Mục tiêu sprint:** Mobile: đặt lịch gặp tại quán, voucher QR, check-in an toàn, đánh giá sau gặp. Partner: quét
voucher. Admin: quản lý quán, cờ khác biệt eKYC, hoàn tiền/đối soát.

**Demo cuối sprint:** A đề xuất lịch tại quán → B xác nhận (voucher A ACTIVE) → nhân viên quán quét QR → A tự check-in
→ check-out → hai bên đánh giá A → match `CLOSED_SUCCESS`.

**Nhóm chạy song song:** Mobile (01 → 02, 03 → 04) ‖ Partner (05) ‖ Admin (06, 07)

---

### FE-S5-01 · Đặt lịch gặp tại quán đối tác

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 2d | FE-S4-04 | FE-S5-05, FE-S5-06 | DONE |

**Mục tiêu:** Màn `t_l_ch_g_p_m_t_i_m_h_n_an_to_n` (BE-S7-01).

**Phạm vi**
- Trong: chọn quán `GET /partners` (đang hoạt động), ngày, khung giờ, tuỳ chọn "chuyên viên xác nhận đặt bàn";
  `POST /me/dates`; lịch hiện tại `GET /me/dates/current` (mọi trạng thái); người được mời: `confirm` / `decline` trong hạn
  (`DATE_RESPONSE_TTL_HOURS`, đếm ngược `expiresAt`); `cancel` (chặn khi < `DATE_CANCEL_CUTOFF_HOURS`); hết hạn → đề xuất
  lịch mới; lỗi `MATCH_NOT_DATING`, `DATE_ALREADY_OPEN`, `DATE_TIME_INVALID`, `CANCEL_TOO_LATE`.
- Ngoài: Đặt bàn qua API quán.

**Tiêu chí nghiệm thu**
- [ ] AC1: Người mời không thấy nút xác nhận; người được mời không thấy nút huỷ khi lịch còn PROPOSED.
- [ ] AC2: Trong vòng cutoff, nút huỷ bị khoá kèm giải thích.

**Test bắt buộc:** Render theo trạng thái × vai trò (bảng); MSW các lỗi.

**File dự kiến:** `apps/mobile/app/(main)/dates/**`, `apps/mobile/src/features/dates/**`.

**Contract / Event:** Không có.

**Ghi chú:** Voucher theo D1 (tạm cấp cho người mời) — câu chữ không hứa voucher cho cả hai.

---

### FE-S5-02 · Voucher QR

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 1d | FE-S5-01 | FE-S5-03 | DONE |

**Mục tiêu:** User xuất trình QR voucher tại quán (BE-S4-05).

**Phạm vi**
- Trong: `GET /me/vouchers` (trạng thái, hạn), `GET /me/vouchers/:id/qr` (token có hạn → tự làm mới trước khi hết hạn),
  tăng độ sáng màn hình khi hiện QR, trạng thái sau khi quán quét (REDEEMED).
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: QR tự làm mới trước khi token hết hạn; voucher không ACTIVE thì không hiện QR.

**Test bắt buộc:** Hook làm mới QR với fake timer.

**File dự kiến:** `apps/mobile/src/features/vouchers/**`.

**Contract / Event:** Không có.

**Ghi chú:** Chưa có thiết kế (FE-D4). Có thể ẩn toàn bộ nếu PO quyết định tắt voucher (D1).

---

### FE-S5-03 · Check-in an toàn

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P1 | 1d | FE-S5-01 | FE-S5-02 | DONE |

**Mục tiêu:** Toggle "Check-in an toàn: gửi vị trí cho chuyên viên" (BE-S7-02).

**Phạm vi**
- Trong: `POST /me/dates/:id/check-in` (tuỳ chọn gửi vị trí **một lần** qua expo-location, xin quyền khi dùng), `POST
  …/check-out`, `GET …/check-in`; chỉ bật trong khung giờ hẹn (`DATE_CHECK_IN_WINDOW_CLOSED`); nhắc check-out sau giờ kết
  thúc; quét voucher tại quán → hiện "đã check-in".
- Ngoài: Theo dõi vị trí liên tục / nền.

**Tiêu chí nghiệm thu**
- [ ] AC1: Từ chối quyền vị trí vẫn check-in được (không gửi vị trí).
- [ ] AC2: Không lưu toạ độ trên máy.

**Test bắt buộc:** MSW check-in/out; mock quyền vị trí.

**File dự kiến:** `apps/mobile/src/features/dates/check-in/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S5-04 · Đánh giá sau gặp

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 1.5d | FE-S5-01 | FE-S5-05 | TODO |

**Mục tiêu:** Màn `nh_gi_sau_g_p_m_t_quy_t_nh_h_n_h` (BE-S7-03).

**Phạm vi**
- Trong: sao 1–5, mức khớp hồ sơ, cảm xúc, quyết định `A_COMMIT` / `B_STOP` (+ lý do, ghi chú — chỉ khi B), enum lấy từ
  contracts; `POST /me/dates/:id/feedback`, `GET …/feedback` (xem lại đánh giá của mình); kết quả: chờ người kia / tốt
  nghiệp (`CLOSED_SUCCESS`) / dừng + cooldown `COOLDOWN_DAYS`; mở được từ push sau giờ hẹn.
- Ngoài: Hiển thị đánh giá của đối phương (BE cấm — không bao giờ có).

**Tiêu chí nghiệm thu**
- [ ] AC1: Chọn A thì không gửi lý do/ghi chú (khớp luật BE `FEEDBACK_INVALID`).
- [ ] AC2: Trước giờ hẹn → `FEEDBACK_NOT_ALLOWED` hiển thị đúng.

**Test bắt buộc:** Form validate theo quyết định; MSW kết quả.

**File dự kiến:** `apps/mobile/app/(main)/dates/feedback*`, `apps/mobile/src/features/feedback/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S5-05 · Partner PWA: đăng nhập nhân viên + quét voucher

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| partner | presentation | P0 | 2d | FE-S1-03 | FE-S5-01, FE-S5-04 | DONE |

**Mục tiêu:** Nhân viên quán xác nhận voucher bằng điện thoại (BE-S4-06).

**Phạm vi**
- Trong: `POST /partner/auth/login`, `GET /partner/auth/me`; quét QR bằng camera web (thư viện quét QR), nhập tay mã
  dự phòng; `POST /partner/vouchers/redeem` → kết quả lớn, rõ (hợp lệ / đã dùng / hết hạn / sai quán); cài như PWA.
- Ngoài: Lịch sử đổi voucher (chờ BE — "Việc BE phát sinh").

**Tiêu chí nghiệm thu**
- [ ] AC1: Quét 2 lần cùng mã → lần 2 báo "đã dùng", không lỗi kỹ thuật.
- [ ] AC2: Chạy trên Safari iOS và Chrome Android (camera).

**Test bắt buộc:** MSW redeem (thành công, `VOUCHER_TOKEN_INVALID`, đã dùng); Playwright có camera giả ở FE-S6-02.

**File dự kiến:** `apps/partner/src/**`.

**Contract / Event:** Không có.

**Ghi chú:** Chưa có thiết kế (FE-D4).

---

### FE-S5-06 · Admin: quán đối tác & nhân viên

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| admin | presentation | P1 | 1d | FE-S3-05 | FE-S5-01, FE-S5-07 | DONE |

**Mục tiêu:** Chuyên viên quản lý danh sách quán dùng voucher.

**Phạm vi**
- Trong: `GET/POST /admin/partners`, `GET/PATCH /admin/partners/:id` (bật/tắt), nhân viên `GET/POST
  /admin/partners/:id/staff`, `PATCH …/staff/:staffId`.
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: Tắt quán → quán không còn trong `GET /partners` phía app (kiểm tra thủ công trên BE local).

**Test bắt buộc:** MSW CRUD.

**File dự kiến:** `apps/admin/src/routes/partners/**`.

**Contract / Event:** Không có.

**Ghi chú:** Chưa có thiết kế (FE-D4).

---

### FE-S5-07 · Admin: cờ khác biệt eKYC, hoàn tiền, đối soát

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| admin | presentation | P1 | 1.5d | FE-S3-05 | FE-S5-06 | DONE |

**Mục tiêu:** Các màn vận hành còn lại cho chuyên viên.

**Phạm vi**
- Trong: hàng chờ cờ `GET /admin/dating/appearance-flags`, chi tiết `GET /admin/dating/feedbacks/:id` (BE ghi audit);
  hoàn tiền thủ công `POST /admin/payments/:id/refund` (xác nhận); báo cáo đối soát `GET /admin/billing/reconciliation-reports`.
- Ngoài: Thao tác "đã xử lý cờ" (BE chưa có).

**Tiêu chí nghiệm thu**
- [ ] AC1: Role thiếu permission không thấy các menu này.

**Test bắt buộc:** MSW danh sách + chi tiết + refund.

**File dự kiến:** `apps/admin/src/routes/operations/**`.

**Contract / Event:** Không có.

**Ghi chú:** Chưa có thiết kế (FE-D4).
