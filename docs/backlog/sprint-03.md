# Sprint 3 — Verification (eKYC & thẩm định độc thân)

**Mục tiêu sprint:** Người dùng nộp CCCD + selfie + giấy xác nhận độc thân; eKYC (provider giả) chấm sơ bộ;
chuyên viên duyệt / từ chối / yêu cầu bổ sung trên admin; hệ thống phát `KycApproved` / `KycRejected`.

**Demo cuối sprint:** Màn 5 (nộp hồ sơ) → màn 6 (theo dõi tiến trình 4 bước) → admin duyệt → trạng thái user chuyển `ACTIVE`.

**Nhóm chạy song song:** (01, 02) → (03, 07) → (04, 05) → (06)
**Có thể chạy song song với Sprint 4.**

---

### BE-S3-01 · Domain `KycSubmission`

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| verification | domain | P0 | 2d | Sprint 2 | BE-S3-02 | DONE |

**Mục tiêu:** Mô hình hoá vòng đời thẩm định hồ sơ và tiến trình 4 bước hiển thị ở màn 6.

**Phạm vi**
- Trong: Aggregate `KycSubmission` với trạng thái `DRAFT → SUBMITTED → UNDER_REVIEW → (NEEDS_MORE_INFO ↔ UNDER_REVIEW) → APPROVED | REJECTED`; các bước kiểm tra (`CCCD_CHIP`, `MARITAL_STATUS`, `MANUAL_REVIEW`, `INTERVIEW`) với trạng thái từng bước; Value Object `CccdNumber` (12 số, validate), `RejectionReason` (enum + ghi chú); event `KycSubmitted`, `KycApproved`, `KycRejected`, `KycMoreInfoRequested`; luật: chỉ duyệt khi đủ 4 bước đạt.
- Ngoài: Persistence (BE-S3-03).

**Tiêu chí nghiệm thu**
- [ ] AC1: `approve()` khi còn bước chưa đạt → `KYC_STEPS_INCOMPLETE`.
- [ ] AC2: `reject()` bắt buộc có lý do; sau REJECTED không chuyển được trạng thái khác.
- [ ] AC3: Mọi chuyển trạng thái hợp lệ phát đúng event.

**Test bắt buộc:** Unit test đủ ma trận chuyển trạng thái.

**File dự kiến:** `packages/modules/verification/domain/**`.

**Contract / Event:** Event payload trong `packages/contracts/src/verification/events.ts`.

**Ghi chú:** —

---

### BE-S3-02 · Port `EkycProvider` + Fake adapter

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| verification | application, infrastructure | P0 | 2d | Sprint 2 | BE-S3-01 | DONE |

**Mục tiêu:** Tách nhà cung cấp eKYC khỏi nghiệp vụ để không bị chặn bởi D2.

**Phạm vi**
- Trong: Port `EkycProvider { ocrIdCard(front, back), checkLiveness(selfie), matchFace(idPortrait, selfie) }` trả kết quả chuẩn hoá (số CCCD, họ tên, ngày sinh, điểm liveness, điểm khớp khuôn mặt); `FakeEkycProvider` cấu hình được kịch bản (thành công / ảnh mờ / không khớp / timeout); timeout + retry ở adapter; hợp đồng test dùng chung (contract test) để adapter thật sau này chạy lại.
- Ngoài: Adapter nhà cung cấp thật (task riêng khi chốt D2).

**Tiêu chí nghiệm thu**
- [ ] AC1: Contract test suite chạy pass với `FakeEkycProvider`.
- [ ] AC2: Timeout provider → trả lỗi hạ tầng có phân loại, không làm hỏng submission (vẫn chuyển chuyên viên duyệt tay).

**Test bắt buộc:** Contract test + unit kịch bản lỗi.

**File dự kiến:** `packages/modules/verification/application/ports/**`, `packages/modules/verification/infrastructure/ekyc/**`.

**Contract / Event:** Không có.

**Ghi chú:** Liên quan D2. Kết quả eKYC chỉ là **gợi ý**, quyết định cuối do chuyên viên.

---

### BE-S3-03 · Use case `SubmitKyc` + lưu trữ mã hoá

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| verification | application, infrastructure, presentation | P0 | 2d | BE-S3-01, BE-S3-02 | BE-S3-07 | DONE |

**Mục tiêu:** Phục vụ màn "Xác thực eKYC" (bước nộp tài liệu).

**Phạm vi**
- Trong: Nhận key upload (CCCD mặt trước/sau, selfie, giấy xác nhận độc thân) đã thuộc user; gọi `EkycProvider`; lưu `cccd_number_enc` + `cccd_number_bidx` (UNIQUE) để chặn 1 CCCD nhiều tài khoản; đối chiếu họ tên/ngày sinh OCR với hồ sơ (lệch → đánh dấu cho chuyên viên); repository Drizzle; `POST /me/kyc`, `GET /me/kyc` (tiến trình 4 bước cho màn 6).
- Ngoài: Điều kiện đã thanh toán (nối ở BE-S4-03 qua event `PaymentSucceeded`; tạm thời cho phép nộp).

**Tiêu chí nghiệm thu**
- [ ] AC1: CCCD đã gắn với tài khoản khác → `CCCD_ALREADY_REGISTERED` (bảo đảm bằng unique index, có test 2 request đồng thời).
- [ ] AC2: Số CCCD không xuất hiện dạng rõ trong DB và log.
- [ ] AC3: `GET /me/kyc` trả 4 bước với trạng thái từng bước.

**Test bắt buộc:** Integration unique đồng thời; use case với Fake provider; HTTP.

**File dự kiến:** `packages/modules/verification/**`, `packages/contracts/src/verification/**`.

**Contract / Event:** Migration `verification.kyc_submissions`; mã lỗi `CCCD_ALREADY_REGISTERED`, `KYC_ALREADY_SUBMITTED`, `KYC_DOCS_MISSING`.

**Ghi chú:** —

---

### BE-S3-04 · Admin: hàng chờ duyệt & quyết định

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| verification | application, infrastructure, presentation | P0 | 2d | BE-S3-03, BE-S2-03, BE-S2-04 | BE-S3-05 | TODO |

**Mục tiêu:** Phục vụ màn "Web Admin – Thẩm định eKYC" (cột hàng chờ + panel chi tiết + thanh nút quyết định).

**Phạm vi**
- Trong: Query hàng chờ (lọc trạng thái, ưu tiên, tìm theo tên/nghề; cursor pagination); query chi tiết (giải mã CCCD, presigned GET ảnh TTL 5 phút, điểm eKYC) — **ghi audit log mỗi lần xem**; use case `AssignReviewer`, `ApproveKyc`, `RejectKyc` (lý do), `RequestMoreInfo` (danh sách tài liệu cần bổ sung), `MarkStepPassed`; permission `kyc:review`, `kyc:decide`.
- Ngoài: Đề xuất ghép đôi trên cùng màn (BE-S5-06).

**Tiêu chí nghiệm thu**
- [ ] AC1: Mỗi lần mở chi tiết tạo 1 bản ghi audit (actor, target, ip).
- [ ] AC2: Hai chuyên viên cùng duyệt 1 hồ sơ → chỉ 1 quyết định thành công (`KYC_ALREADY_DECIDED`).
- [ ] AC3: Approve/Reject ghi event vào outbox trong cùng transaction.

**Test bắt buộc:** Integration đồng thời; HTTP phân quyền; kiểm tra audit.

**File dự kiến:** `packages/modules/verification/**`, `packages/contracts/src/verification/admin/**`.

**Contract / Event:** DTO admin; mã lỗi `KYC_ALREADY_DECIDED`.

**Ghi chú:** —

---

### BE-S3-05 · Phỏng vấn sơ bộ 15 phút

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| verification | domain, application, infrastructure, presentation | P1 | 1.5d | BE-S3-03 | BE-S3-04 | DONE |

**Mục tiêu:** Phục vụ nút "Đặt lịch phỏng vấn làm quen 15 phút" (màn 6) và "Nhật ký phỏng vấn" (admin).

**Phạm vi**
- Trong: Chuyên viên mở slot; user đặt 1 slot (không trùng, giữ chỗ an toàn khi đồng thời); huỷ/đổi lịch trước 2h; chuyên viên ghi nhận xét + đánh dấu bước `INTERVIEW` đạt/không đạt.
- Ngoài: Gọi video (dùng công cụ ngoài, chỉ lưu link).

**Tiêu chí nghiệm thu**
- [ ] AC1: 2 user đặt cùng 1 slot đồng thời → chỉ 1 thành công.
- [ ] AC2: Ghi nhận xét phỏng vấn cập nhật bước `INTERVIEW` của submission.

**Test bắt buộc:** Integration đồng thời; unit luật huỷ trước 2h.

**File dự kiến:** `packages/modules/verification/**`.

**Contract / Event:** Migration `verification.interview_slots`; mã lỗi `SLOT_TAKEN`, `CANCEL_TOO_LATE`.

**Ghi chú:** —

---

### BE-S3-06 · Job xoá ảnh eKYC theo thời hạn lưu trữ

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| verification | application, infrastructure | P1 | 1d | BE-S3-04 | — | TODO |

**Mục tiêu:** Giảm thiểu dữ liệu nhạy cảm lưu giữ theo nguyên tắc tối thiểu hoá dữ liệu.

**Phạm vi**
- Trong: Job hằng ngày xoá ảnh CCCD/selfie của submission đã quyết định quá `KYC_MEDIA_RETENTION_DAYS`; giữ metadata + kết quả; ghi audit (actor = system).
- Ngoài: Xoá tài khoản theo yêu cầu (BE-S7-06).

**Tiêu chí nghiệm thu**
- [ ] AC1: Submission quyết định cách đây > N ngày → object bị xoá, cột key set null, có audit.
- [ ] AC2: Chạy job 2 lần không lỗi (idempotent).

**Test bắt buộc:** Integration với MinIO + FakeClock.

**File dự kiến:** `packages/modules/verification/**`, `apps/worker/src/jobs/**`.

**Contract / Event:** Không có.

**Ghi chú:** D6.

---

### BE-S3-07 · Facade verification cho module khác

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| verification | application | P0 | 0.5d | BE-S3-03 | BE-S3-03 | DONE |

**Mục tiêu:** Cho matching/profile hỏi trạng thái xác thực mà không đọc bảng verification (A3).

**Phạm vi**
- Trong: `VerificationFacade { isVerified(userId), getBadges(userId) }` (badge: `CCCD_VERIFIED`, `SINGLE_VERIFIED`, `INTERVIEWED`); cập nhật `GET /me` (BE-S2-08) dùng facade để trả `UNDER_REVIEW` / `ACTIVE`.
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: User được duyệt → `isVerified=true`, `GET /me` trả `ACTIVE`.

**Test bắt buộc:** Unit facade + HTTP `GET /me`.

**File dự kiến:** `packages/modules/verification/application/facade.ts`, `packages/modules/profile/**` (chỉ phần onboarding query).

**Contract / Event:** Không có.

**Ghi chú:** —
