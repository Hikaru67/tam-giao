# Sprint 7 — Dating, Notification & Hardening

**Mục tiêu sprint:** Đặt lịch gặp tại quán đối tác (kích hoạt voucher), check-in an toàn, đánh giá kín sau gặp → `CLOSED_SUCCESS`
hoặc `CLOSED_STOPPED` + cooldown; thông báo đẩy/SMS cho các mốc quan trọng; quyền dữ liệu cá nhân; gia cố bảo mật, sẵn sàng staging.

**Demo cuối sprint:** Luồng đầy đủ 14 bước trên staging: đăng ký → xác thực → ghép → chat → đặt hẹn → quét voucher → đánh giá → tốt nghiệp.

**Nhóm chạy song song:** (01, 05, 06) → (02, 03, 04) → (07, 08) → (09)

---

### BE-S7-01 · Đặt lịch gặp mặt tại quán đối tác

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| dating | domain, application, infrastructure, presentation | P0 | 2d | Sprint 5, BE-S4-05, BE-S4-06 | BE-S7-05, BE-S7-06 | TODO |

**Mục tiêu:** Phục vụ màn "Đặt lịch Gặp mặt & Điểm hẹn An toàn".

**Phạm vi**
- Trong: Aggregate `DatePlan` (`PROPOSED → CONFIRMED → CHECKED_IN → COMPLETED`, `PROPOSED → DECLINED|EXPIRED`, `CONFIRMED → CANCELLED`); chỉ tạo khi match `DATING`; người mời chọn ngày, khung giờ, quán (partner active); người kia xác nhận trong 24h (job hết hạn); tuỳ chọn "Chuyên viên xác nhận đặt bàn"; `CONFIRMED` → event `DateConfirmed` → billing `ActivateVoucher` cho người mời; huỷ trước 4h; tối đa 1 lịch đang mở / match.
- Ngoài: Đặt bàn qua API quán.

**Tiêu chí nghiệm thu**
- [ ] AC1: Match không ở `DATING` → `MATCH_NOT_DATING`.
- [ ] AC2: Xác nhận → voucher của người mời chuyển `ACTIVE` (qua event, idempotent).
- [ ] AC3: Quá 24h không xác nhận → `EXPIRED`, có thể đề xuất lịch mới.

**Test bắt buộc:** Unit domain; integration chuỗi `DateConfirmed` → `VoucherActivated`.

**File dự kiến:** `packages/modules/dating/**`, handler trong `billing` (file handler mới), `packages/contracts/src/dating/**`.

**Contract / Event:** Migration `dating.date_plans`; event `DateProposed`, `DateConfirmed`, `DateCancelled`; mã lỗi `MATCH_NOT_DATING`, `DATE_ALREADY_OPEN`, `CANCEL_TOO_LATE`.

**Ghi chú:** Voucher cấp cho ai (người mời / cả hai) phụ thuộc D1 — mặc định người đã thanh toán và đang có voucher `RESERVED`.

---

### BE-S7-02 · Check-in an toàn trong buổi hẹn

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| dating | application, infrastructure, presentation | P1 | 1d | BE-S7-01 | BE-S7-03 | TODO |

**Mục tiêu:** Toggle "Check-in an toàn: gửi vị trí cho chuyên viên" (màn 12).

**Phạm vi**
- Trong: `CheckIn` / `CheckOut`; lưu vị trí thô tối thiểu (chỉ trong khung giờ hẹn, tự xoá sau 24h); quá giờ kết thúc + 60 phút chưa check-out → cảnh báo chuyên viên; quét voucher tại quán (event `VoucherRedeemed`) tự đánh dấu check-in.
- Ngoài: Theo dõi vị trí liên tục.

**Tiêu chí nghiệm thu**
- [ ] AC1: Dữ liệu vị trí bị xoá sau 24h (job, FakeClock).
- [ ] AC2: Không check-out quá hạn → tạo cảnh báo.

**Test bắt buộc:** Integration job.

**File dự kiến:** `packages/modules/dating/**`.

**Contract / Event:** Event `DateCheckInOverdue`.

**Ghi chú:** —

---

### BE-S7-03 · Đánh giá kín sau gặp → đóng match

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| dating, matching | domain, application, infrastructure, presentation | P0 | 1.5d | BE-S7-01 | BE-S7-02 | TODO |

**Mục tiêu:** Phục vụ màn "Đánh giá sau Gặp mặt & Quyết định Hẹn hò".

**Phạm vi**
- Trong: `SubmitFeedback` (sao, mức khớp hồ sơ eKYC, cảm xúc, quyết định `A_COMMIT` / `B_STOP` + lý do kín); feedback **không bao giờ** trả cho đối phương; khi đủ 2 feedback hoặc 1 bên chọn B → event `FeedbackSubmitted` → matching: cả hai A → `CLOSED_SUCCESS` (tốt nghiệp); có B → `CLOSED_STOPPED` + cooldown `COOLDOWN_DAYS` cho cả hai; "Có khác biệt" về ngoại hình so với eKYC → tạo cờ cho chuyên viên.
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: Cả hai chọn A → `CLOSED_SUCCESS`, slot giải phóng, không cooldown.
- [ ] AC2: Một bên chọn B → `CLOSED_STOPPED` ngay, cả hai cooldown 7 ngày.
- [ ] AC3: API của đối phương không trả bất kỳ trường feedback nào.

**Test bắt buộc:** Integration chuỗi event; HTTP kiểm tra rò rỉ dữ liệu.

**File dự kiến:** `packages/modules/dating/**`, `packages/modules/matching/application/use-cases/close-match.ts`.

**Contract / Event:** Migration `dating.feedbacks`; event `FeedbackSubmitted`.

**Ghi chú:** —

---

### BE-S7-04 · Hết hạn 14 ngày + nhắc nhở giai đoạn tìm hiểu

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| matching | application, infrastructure | P0 | 1d | BE-S5-05, BE-S7-05 | BE-S7-03 | TODO |

**Mục tiêu:** Đóng vòng đời khi hết 14 ngày mà chưa gặp; nhắc người dùng hẹn gặp trước hạn.

**Phạm vi**
- Trong: Hết hạn `DATING` chưa `MET` → `CLOSED_STOPPED` (không cooldown phạt, ghi lý do `TIMEOUT`); job nhắc ngày 7 và ngày 12 ("Mục tiêu: gặp mặt trước ngày 14"); `DatePlan COMPLETED` → `markMet`.
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: Tua 14 ngày → match đóng đúng lý do, hội thoại đóng.
- [ ] AC2: Nhắc nhở mỗi mốc chỉ gửi 1 lần.

**Test bắt buộc:** Integration FakeClock.

**File dự kiến:** `packages/modules/matching/**`, `apps/worker/src/jobs/**`.

**Contract / Event:** Không có event mới.

**Ghi chú:** —

---

### BE-S7-05 · Module notification: push + SMS + template

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| notification | application, infrastructure, presentation | P0 | 2d | Sprint 1 | BE-S7-01, BE-S7-06 | TODO |

**Mục tiêu:** Người dùng không bỏ lỡ gợi ý 24h, phản hồi, lịch hẹn, cảnh báo an toàn.

**Phạm vi**
- Trong: Đăng ký device token (`POST /me/devices`); port `PushSender` + `ExpoPushSender` + `FakePushSender`; `SmsSender` dùng lại từ identity; template tiếng Việt theo event (`MatchOffered`, còn 2h trước hết hạn, `MatchAwaitingResponse`, `MatchStartedDating`, `MessageSent` khi offline, `DateProposed/Confirmed`, nhắc lịch trước 2h, `KycApproved/Rejected`, `RefundCompleted`, cập nhật báo cáo); cài đặt nhận thông báo; không đưa PII nhạy cảm vào nội dung push (vd không ghi tên đối phương trên màn khoá).
- Ngoài: Email.

**Tiêu chí nghiệm thu**
- [ ] AC1: Mỗi event trong danh sách sinh đúng 1 thông báo (idempotent).
- [ ] AC2: Token thiết bị không hợp lệ (Expo báo lỗi) → tự xoá.

**Test bắt buộc:** Integration handler với FakePushSender.

**File dự kiến:** `packages/modules/notification/**`, `apps/worker/src/**`.

**Contract / Event:** Migration `notification.devices`, `notification.deliveries`.

**Ghi chú:** D4.

---

### BE-S7-06 · Quyền dữ liệu cá nhân: xuất & xoá tài khoản

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| identity (điều phối) | application, infrastructure, presentation | P0 | 1.5d | Sprint 6 | BE-S7-01, BE-S7-05 | TODO |

**Mục tiêu:** Đáp ứng quyền của chủ thể dữ liệu theo Nghị định 13/2023.

**Phạm vi**
- Trong: `RequestDataExport` (job tạo file JSON + ảnh của chính chủ, presigned link 24h); `DeleteAccount` (xác nhận OTP; đóng match đang mở; event `AccountDeletionRequested` → mỗi module tự ẩn danh/xoá dữ liệu của mình theo handler riêng; giữ lại bản ghi bắt buộc như ledger, audit, báo cáo vi phạm ở dạng ẩn danh); trạng thái xử lý theo dõi được.
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: Sau khi xoá: không còn PII của user trong profile/verification/messaging/storage; ledger còn nhưng không liên kết được danh tính.
- [ ] AC2: File xuất chỉ chứa dữ liệu của chính chủ.

**Test bắt buộc:** Integration xuyên module (kiểm tra từng schema).

**File dự kiến:** `packages/modules/identity/**` + file handler mới trong từng module.

**Contract / Event:** Event `AccountDeletionRequested`.

**Ghi chú:** —

---

### BE-S7-07 · Gia cố bảo mật

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| api, repo | devops, presentation | P0 | 2d | BE-S7-01…06 | BE-S7-08 | TODO |

**Mục tiêu:** Giảm rủi ro trước khi mở beta.

**Phạm vi**
- Trong: Rate limit toàn cục + theo route nhạy cảm; security headers; giới hạn kích thước body; `pnpm audit` trong CI; rà soát log không có PII (script grep log test); rà soát toàn bộ endpoint admin có permission + audit (test tự động liệt kê route admin thiếu guard); kiểm tra IDOR trên mọi route `/me/*` có tham số id.
- Ngoài: Pentest bên thứ ba.

**Tiêu chí nghiệm thu**
- [ ] AC1: Test tự động fail nếu có route admin không gắn `requireAdmin`.
- [ ] AC2: Không route `/me/*` nào trả dữ liệu của user khác (test IDOR theo bảng route).

**Test bắt buộc:** Test meta trên danh sách route.

**File dự kiến:** `apps/api/src/http/**`, `.github/workflows/ci.yml`, `tools/security/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### BE-S7-08 · Staging deploy, OpenAPI, observability

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| repo | devops | P1 | 1.5d | Sprint 6 | BE-S7-07 | TODO |

**Mục tiêu:** Có môi trường staging để FE và QA dùng.

**Phạm vi**
- Trong: Dockerfile cho api/worker (multi-stage, non-root); pipeline deploy staging khi merge `main`; chạy migration tự động có khoá; tài liệu OpenAPI xuất bản; Sentry (api, worker) với scrub PII; metric cơ bản (độ trễ, lỗi, độ dài queue, outbox chưa publish); runbook sao lưu/khôi phục Postgres.
- Ngoài: Production (chờ D5).

**Tiêu chí nghiệm thu**
- [ ] AC1: Merge `main` → staging cập nhật, `/ready` xanh.
- [ ] AC2: Outbox tồn đọng > ngưỡng → cảnh báo.

**Test bắt buộc:** Smoke test sau deploy (health + luồng OTP với Fake SMS).

**File dự kiến:** `apps/*/Dockerfile`, `.github/workflows/deploy-staging.yml`, `docs/runbooks/**`.

**Contract / Event:** Không có.

**Ghi chú:** D5.

---

### BE-S7-09 · Kiểm thử tải & e2e toàn luồng

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| repo | devops | P1 | 1.5d | BE-S7-08 | — | TODO |

**Mục tiêu:** Xác nhận hệ thống chạy đúng toàn luồng 14 bước và chịu được tải beta.

**Phạm vi**
- Trong: Test e2e API chạy toàn luồng 2 user + 1 chuyên viên (Fake provider) trên staging; k6: 200 user đồng thời chat + 50 req/s API chung, p95 < 300ms; đo thời gian relay outbox p95 < 5s.
- Ngoài: Test tải production.

**Tiêu chí nghiệm thu**
- [ ] AC1: E2E toàn luồng pass trên staging.
- [ ] AC2: Báo cáo k6 đạt ngưỡng hoặc ghi rõ điểm nghẽn + đề xuất.

**Test bắt buộc:** E2E + k6 script lưu trong repo.

**File dự kiến:** `tests/e2e/**`, `tests/load/**`.

**Contract / Event:** Không có.

**Ghi chú:** —
