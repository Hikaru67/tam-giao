# Sprint FE-04 — Ghép đôi & Chat

**Mục tiêu sprint:** Mobile: nhận gợi ý độc quyền, đồng ý/từ chối, chờ phản hồi, xem hồ sơ đối phương, chat realtime,
báo cáo vi phạm. Admin: đề xuất ghép, kiểm duyệt báo cáo và tin gắn cờ, khoá tài khoản.

**Demo cuối sprint:** Chuyên viên đề xuất A–B → A đồng ý (B thấy "chờ phản hồi" đếm ngược) → B đồng ý → chat realtime
→ A báo cáo B → match khoá → chuyên viên xử lý báo cáo + khoá B.

**Nhóm chạy song song:** Mobile (01 → 02, 03 → 04 → 05, 06) ‖ Admin (07, 08)

---

### FE-S4-01 · Gợi ý ghép độc quyền

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 1.5d | FE-S3-04 | FE-S4-07 | DONE |

**Mục tiêu:** Màn `g_i_gh_p_i_c_quy_n`.

**Phạm vi**
- Trong: `GET /me/match` (OFFERED, `expiresAt`), `GET /me/match/profile` (phần công khai: tên gọi, tuổi, thành phố, nghề,
  học vấn, tự bạch, sở thích, ảnh); đếm ngược theo `expiresAt` (`OFFER_TTL_HOURS`); `POST /me/match/accept`, `decline`
  (xác nhận); hết hạn → trạng thái "đang tìm gợi ý mới".
- Ngoài: Phần riêng tư (BE-S7-10, BLOCKED); % tương hợp, 3 trụ cột, khối chuyên viên (FE-D6).

**Tiêu chí nghiệm thu**
- [ ] AC1: Hết giờ trên màn → nút đồng ý bị khoá, gọi lại `GET /me/match`.
- [ ] AC2: Không hiển thị trường nào ngoài `matchProfileResponseSchema`.

**Test bắt buộc:** Render OFFERED/EXPIRED; accept/decline với MSW (`OFFER_EXPIRED`, `NO_OPEN_MATCH`).

**File dự kiến:** `apps/mobile/app/(main)/match/**`, `apps/mobile/src/features/match/**`.

**Contract / Event:** Không có.

**Ghi chú:** FE-D5/FE-D6: bỏ "Khuôn mặt liveness 100%", "Bảo chứng vàng", "% tương hợp".

---

### FE-S4-02 · Chờ đối phương phản hồi

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 0.5d | FE-S4-01 | FE-S4-03 | DONE |

**Mục tiêu:** Màn `ch_ph_n_h_i_gh_p_i_1_1`.

**Phạm vi**
- Trong: trạng thái AWAITING_RESPONSE, đếm ngược `RESPONSE_TTL_HOURS`, `POST /me/match/withdraw` (rút lời đồng ý, xác
  nhận); nhận push `MatchStartedDating` → chuyển vào chat.
- Ngoài: "Lời ngỏ" tự do (BE chưa có trường này — xác nhận với PO).

**Tiêu chí nghiệm thu**
- [ ] AC1: Đối phương đồng ý khi đang mở màn → tự chuyển sang hội thoại.

**Test bắt buộc:** Render + withdraw với MSW.

**File dự kiến:** `apps/mobile/src/features/match/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S4-03 · Chi tiết hồ sơ đối phương (phần công khai)

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P1 | 1d | FE-S4-01 | FE-S4-02 | TODO |

**Mục tiêu:** Màn `chi_ti_t_h_s_quan_ni_m_h_n_nh_n`.

**Phạm vi**
- Trong: thư viện ảnh, các khối công khai từ `GET /me/match/profile`; chỗ cho phần riêng tư hiển thị trạng thái "chưa mở"
  (không gọi API riêng tư).
- Ngoài: Thu nhập, bất động sản, CIC, lịch sử tình cảm, kế hoạch kết hôn — chờ BE-S7-10.

**Tiêu chí nghiệm thu**
- [ ] AC1: Không có trường riêng tư nào được render từ dữ liệu giả cứng.

**Test bắt buộc:** Render với hồ sơ đủ/thiếu trường.

**File dự kiến:** `apps/mobile/src/features/match/profile/**`.

**Contract / Event:** Không có.

**Ghi chú:** Mở rộng khi BE-S7-10 xong (chỉ thêm trường tuỳ chọn).

---

### FE-S4-04 · Chat realtime

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile, packages/api-client | infrastructure, presentation | P0 | 3d | FE-S4-02 | FE-S4-08 | TODO |

**Mục tiêu:** Màn `tr_chuy_n_h_n_h_c_quy_n` (BE-S6-01…03).

**Phạm vi**
- Trong: client WebSocket `/ws` trong api-client (xác thực, reconnect có backoff, ack theo `clientMessageId`, hàng đợi gửi
  lại khi mất mạng, frame parse bằng schema contracts); lịch sử `GET /me/conversations/:id/messages` (phân trang, dedupe với
  realtime); đã đọc `POST /me/conversations/:id/read`; gợi ý mở lời `GET …/icebreakers`; giới hạn `MESSAGE_MAX_LENGTH`;
  `RATE_LIMITED` (`MESSAGE_RATE_LIMIT_PER_MINUTE`); tin bị lọc lừa đảo → cảnh báo; hội thoại đóng/khoá → chỉ đọc; thanh
  "Ngày x/14" theo `DATING_DAYS`; chặn chụp màn hình (F5).
- Ngoài: Gửi ảnh/thoại (BE chưa có).

**Tiêu chí nghiệm thu**
- [ ] AC1: Mất mạng khi gửi → tin ở trạng thái "đang gửi", có mạng lại tự gửi, không trùng (ack theo `clientMessageId`).
- [ ] AC2: Tin realtime và tin tải từ lịch sử không bị nhân đôi.
- [ ] AC3: Nội dung tin không ghi vào log/analytics.

**Test bắt buộc:** Unit client WS với server giả (reconnect, ack, dedupe); render màn.

**File dự kiến:** `packages/api-client/src/ws/**`, `apps/mobile/app/(main)/chat/**`, `apps/mobile/src/features/chat/**`.

**Contract / Event:** Không có.

**Ghi chú:** Đọc frame protocol ở `packages/contracts/src/messaging/**` và `chat-gateway.ts`.

---

### FE-S4-05 · Hộp thư: danh sách hội thoại & giai đoạn tìm hiểu

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P1 | 1d | FE-S4-04 | FE-S4-06 | TODO |

**Mục tiêu:** Màn `h_p_th_h_n_h_t_v_n_vi_n` (phần có API).

**Phạm vi**
- Trong: `GET /me/conversations` (tin mới nhất, chưa đọc), thẻ đối phương + "Ngày x/14", lối tắt "đặt lịch gặp" (FE-S5-01).
- Ngoài: Khối "Chuyên viên đồng hành riêng", "Đặt hẹn tư vấn 1-1", "Tương hợp 94%" (FE-D6).

**Tiêu chí nghiệm thu**
- [ ] AC1: Số tin chưa đọc khớp sau khi đọc trong màn chat.

**Test bắt buộc:** Render danh sách rỗng/có tin.

**File dự kiến:** `apps/mobile/app/(main)/inbox/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S4-06 · Báo cáo vi phạm & trung tâm an toàn

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile | presentation | P0 | 1.5d | FE-S4-04 | FE-S4-05 | TODO |

**Mục tiêu:** Màn `b_o_c_o_vi_ph_m_trung_t_m_an_to_n_kh_n_c_p` (BE-S6-04).

**Phạm vi**
- Trong: chọn loại vi phạm (danh sách từ contracts), mô tả (giới hạn ký tự), ảnh bằng chứng (presigned, tối đa theo
  contracts), cờ khẩn cấp; `POST /me/reports`; sau gửi → giải thích match đã tạm khoá, chuyên viên phản hồi trong
  `SAFETY_RESPONSE_SLA_MINUTES`; push cập nhật báo cáo.
- Ngoài: Gọi hotline (chờ PO số điện thoại).

**Tiêu chí nghiệm thu**
- [ ] AC1: Gửi báo cáo → màn chat chuyển chỉ đọc.

**Test bắt buộc:** Form validate + gửi với MSW.

**File dự kiến:** `apps/mobile/app/(main)/safety/**`, `apps/mobile/src/features/safety/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S4-07 · Admin: đề xuất ghép đôi

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| admin | presentation | P0 | 2d | FE-S3-05 | FE-S4-01 | DONE |

**Mục tiêu:** Tab "Đề xuất Ghép đôi 1-1" trong khung admin.

**Phạm vi**
- Trong: chọn người dùng đã duyệt → `GET /admin/users/:id/candidates` (lọc, lý do loại) → so sánh 2 hồ sơ → `POST
  /admin/matches`; danh sách match `GET /admin/matches` theo trạng thái; lỗi độc quyền (đang có match, cooldown).
- Ngoài: Thuật toán tương hợp (FE-D6).

**Tiêu chí nghiệm thu**
- [ ] AC1: Ứng viên đang có match/cooldown không chọn được, có lý do.

**Test bắt buộc:** MSW: danh sách, tạo match, lỗi độc quyền.

**File dự kiến:** `apps/admin/src/routes/matching/**`, `apps/admin/src/features/matching/**`.

**Contract / Event:** Không có.

**Ghi chú:** Chưa có thiết kế chi tiết (chỉ có tab) — FE-D4.

---

### FE-S4-08 · Admin: kiểm duyệt báo cáo, tin gắn cờ, khoá tài khoản

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| admin | presentation | P0 | 2d | FE-S3-05 | FE-S4-04 | DONE |

**Mục tiêu:** Tab "Báo cáo Vi phạm & Khiếu nại" (BE-S6-05/06).

**Phạm vi**
- Trong: hàng chờ `GET /admin/reports` (khẩn cấp lên đầu, đồng hồ SLA), chi tiết + bằng chứng presigned, `start-review`,
  `resolve` (kết luận); tin gắn cờ `GET /admin/flagged-messages(/:id)`; khoá tài khoản `POST /admin/users/:id/ban` (xác
  nhận 2 bước, lý do).
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: Báo cáo khẩn cấp quá `SAFETY_RESPONSE_SLA_MINUTES` hiển thị cảnh báo đỏ.

**Test bắt buộc:** MSW cho hàng chờ, resolve, ban.

**File dự kiến:** `apps/admin/src/routes/moderation/**`, `apps/admin/src/features/moderation/**`.

**Contract / Event:** Không có.

**Ghi chú:** Chưa có thiết kế chi tiết — FE-D4.
