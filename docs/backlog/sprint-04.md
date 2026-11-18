# Sprint 4 — Billing & Voucher

**Mục tiêu sprint:** Thu khoản xác thực 299.000đ qua cổng thanh toán (adapter giả), webhook idempotent, ledger chỉ ghi thêm,
tự động hoàn tiền khi hồ sơ bị từ chối, phát hành voucher 300.000đ và đổi voucher bằng QR tại quán đối tác.

**Demo cuối sprint:** Thanh toán → `PaymentSucceeded` → voucher `RESERVED`; admin từ chối hồ sơ → hoàn tiền + voucher `VOID`;
voucher `ACTIVE` → quán quét QR → `REDEEMED` (quét lần 2 bị từ chối).

**Nhóm chạy song song:** (01, 02, 06) → (03) → (04, 05) → (07)
**Có thể chạy song song với Sprint 3** (chỉ BE-S4-04 cần event `KycRejected` từ BE-S3-01).

---

### BE-S4-01 · Domain billing: Payment, Ledger, Voucher

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| billing | domain | P0 | 2d | Sprint 1 | BE-S4-02, BE-S4-06 | IN_REVIEW |

**Mục tiêu:** Mô hình hoá tiền và voucher chính xác, không thể sai lệch.

**Phạm vi**
- Trong: Aggregate `VerificationPayment` (`PENDING → SUCCEEDED | FAILED`, `SUCCEEDED → REFUND_PENDING → REFUNDED`); `LedgerEntry` (type: `CHARGE`, `REFUND`, `VOUCHER_ISSUE`, `VOUCHER_REDEEM`, `VOUCHER_VOID`; amount `Money`); aggregate `Voucher` (`RESERVED → ACTIVE → REDEEMED`, `RESERVED|ACTIVE → VOID | EXPIRED`; giá trị `VOUCHER_VND`; hạn `VOUCHER_TTL_DAYS` tính từ ngày hồ sơ được duyệt); event `PaymentSucceeded`, `PaymentFailed`, `RefundCompleted`, `VoucherIssued`, `VoucherActivated`, `VoucherRedeemed`, `VoucherVoided`.
- Ngoài: Persistence, gateway.

**Tiêu chí nghiệm thu**
- [ ] AC1: Không thể refund payment chưa `SUCCEEDED` hoặc refund 2 lần.
- [ ] AC2: Voucher `REDEEMED`/`VOID`/`EXPIRED` không thể chuyển tiếp.
- [ ] AC3: Mọi phép tính tiền dùng `Money`, không có số thực.

**Test bắt buộc:** Unit đủ ma trận chuyển trạng thái của Payment và Voucher.

**File dự kiến:** `packages/modules/billing/domain/**`.

**Contract / Event:** Event payload billing trong contracts.

**Ghi chú:** D1: dùng tên trung tính `VerificationPayment`; không dùng từ "deposit/escrow" trong tên class.

---

### BE-S4-02 · Port `PaymentGateway` + Fake adapter

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| billing | application, infrastructure | P0 | 2d | Sprint 1 | BE-S4-01 | DONE |

**Mục tiêu:** Tách cổng thanh toán khỏi nghiệp vụ (chưa chốt D3).

**Phạm vi**
- Trong: Port `PaymentGateway { createCheckout(orderId, amount, returnUrl) → {checkoutUrl, qrData}; verifyWebhook(headers, rawBody) → WebhookEvent; refund(gatewayTxnId, amount) }`; `FakePaymentGateway` có endpoint giả lập "thanh toán thành công/thất bại" để test end-to-end; contract test suite dùng chung cho adapter thật.
- Ngoài: Adapter PayOS/VNPay/MoMo (task riêng khi chốt D3).

**Tiêu chí nghiệm thu**
- [ ] AC1: Contract test pass với Fake.
- [ ] AC2: Webhook chữ ký sai → `verifyWebhook` trả lỗi.

**Test bắt buộc:** Contract test.

**File dự kiến:** `packages/modules/billing/application/ports/**`, `packages/modules/billing/infrastructure/gateway/**`.

**Contract / Event:** Không có.

**Ghi chú:** D3.

---

### BE-S4-03 · Thanh toán xác thực + webhook idempotent

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| billing | application, infrastructure, presentation | P0 | 2d | BE-S4-01, BE-S4-02 | — | TODO |

**Mục tiêu:** Phục vụ CTA "Ký quỹ 299.000đ & Nhận Voucher 300k" (màn 5) và thẻ "Đã ghi nhận" (màn 6).

**Phạm vi**
- Trong: `CreateVerificationCheckout` (1 user chỉ 1 payment `PENDING|SUCCEEDED` tại một thời điểm, idempotency key từ client); `HandlePaymentWebhook` (unique `gateway_txn_id`; SUCCEEDED → ledger `CHARGE` + `VOUCHER_ISSUE`, tạo Voucher `RESERVED`, event `PaymentSucceeded` — tất cả 1 transaction); `POST /me/payments/verification`, `POST /webhooks/payments/:gateway`, `GET /me/payments`; facade `BillingFacade.hasPaidVerification(userId)`; cập nhật `GET /me` + chặn `SubmitKyc` khi chưa thanh toán (sửa có kiểm soát trong verification qua facade).
- Ngoài: Hoàn tiền (BE-S4-04).

**Tiêu chí nghiệm thu**
- [ ] AC1: Webhook gửi lại 3 lần → chỉ 1 bộ ledger + 1 voucher.
- [ ] AC2: 2 request tạo checkout đồng thời → 1 payment.
- [ ] AC3: Webhook chữ ký sai → 401, không ghi gì.
- [ ] AC4: Chưa thanh toán → `SubmitKyc` trả `PAYMENT_REQUIRED`.

**Test bắt buộc:** Integration idempotency + đồng thời; HTTP webhook.

**File dự kiến:** `packages/modules/billing/**`, `packages/modules/verification/application/use-cases/submit-kyc.ts` (chỉ thêm kiểm tra facade), `packages/contracts/src/billing/**`.

**Contract / Event:** Migration `billing.payments`, `billing.ledger_entries`, `billing.vouchers`; mã lỗi `PAYMENT_REQUIRED`, `PAYMENT_ALREADY_EXISTS`, `WEBHOOK_INVALID`.

**Ghi chú:** Webhook route cần raw body để verify chữ ký.

---

### BE-S4-04 · Hoàn tiền khi hồ sơ bị từ chối

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| billing | application, infrastructure, presentation | P0 | 1.5d | BE-S4-03, BE-S3-01 | BE-S4-05 | TODO |

**Mục tiêu:** Thực hiện cam kết "Hoàn 100% nếu hồ sơ không được duyệt trong `REFUND_SLA_HOURS`".

**Phạm vi**
- Trong: Handler `KycRejected` → `RefundVerificationPayment` (payment `REFUND_PENDING`, voucher `VOID`, gọi gateway; thành công → `REFUNDED` + ledger `REFUND`, `VOUCHER_VOID`); retry backoff khi gateway lỗi; cảnh báo khi quá SLA; admin refund thủ công (permission `billing:refund`, bắt buộc lý do, audit).
- Ngoài: Hoàn tiền một phần.

**Tiêu chí nghiệm thu**
- [ ] AC1: Event `KycRejected` xử lý 2 lần → chỉ 1 lần gọi refund.
- [ ] AC2: Gateway lỗi tạm thời → retry, cuối cùng `REFUNDED`.
- [ ] AC3: Quá SLA chưa hoàn → log cảnh báo mức error (để gắn alert).

**Test bắt buộc:** Integration handler idempotent; unit retry với Fake gateway lỗi.

**File dự kiến:** `packages/modules/billing/**`, `apps/worker/src/**` (đăng ký handler).

**Contract / Event:** Event `RefundCompleted`.

**Ghi chú:** D1.

---

### BE-S4-05 · Voucher QR & đổi voucher tại quán

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| billing | application, infrastructure, presentation | P0 | 2d | BE-S4-03, BE-S4-06 | BE-S4-04 | TODO |

**Mục tiêu:** Phục vụ thẻ voucher (màn 6, 11, 12) và trang quét QR cho quán đối tác.

**Phạm vi**
- Trong: `ActivateVoucher` (RESERVED → ACTIVE; sẽ được gọi khi `DateConfirmed` ở S7, tạm thời có use case + test); `GetVoucherQr` (token ký HMAC chứa voucherId + exp ngắn 60–120s, client làm mới); `RedeemVoucher` từ partner (verify token, voucher ACTIVE, chưa hết hạn, đúng partner nếu đã gắn) — 1 transaction, `SELECT … FOR UPDATE`, ledger `VOUCHER_REDEEM`; job hết hạn voucher → `EXPIRED`; routes `GET /me/vouchers`, `GET /me/vouchers/:id/qr`, `POST /partner/vouchers/redeem`.
- Ngoài: Đối soát thanh toán với quán (BE-S4-07 / ngoài MVP).

**Tiêu chí nghiệm thu**
- [ ] AC1: Quét cùng QR 2 lần (kể cả đồng thời) → lần 2 `VOUCHER_ALREADY_REDEEMED`.
- [ ] AC2: Token hết hạn hoặc bị sửa → `VOUCHER_TOKEN_INVALID`.
- [ ] AC3: Voucher quá hạn → job chuyển `EXPIRED`; redeem → `VOUCHER_EXPIRED`.

**Test bắt buộc:** Integration đồng thời; unit token; job với FakeClock.

**File dự kiến:** `packages/modules/billing/**`, `packages/contracts/src/billing/**`.

**Contract / Event:** Mã lỗi `VOUCHER_ALREADY_REDEEMED`, `VOUCHER_TOKEN_INVALID`, `VOUCHER_EXPIRED`, `VOUCHER_NOT_ACTIVE`.

**Ghi chú:** —

---

### BE-S4-06 · Quán đối tác & xác thực nhân viên quán

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| billing | application, infrastructure, presentation | P1 | 1d | Sprint 2 | BE-S4-01 | TODO |

**Mục tiêu:** Danh sách quán an toàn (The Running Bean, RuNam…) cho màn đặt hẹn và quyền quét QR.

**Phạm vi**
- Trong: Bảng `billing.partners` (tên, địa chỉ, ảnh, tag, active); CRUD admin (permission `partner:manage`); tài khoản nhân viên quán (mã PIN + thiết bị) → token partner ngắn hạn; query public danh sách quán active cho user đã xác thực.
- Ngoài: Thanh toán cho quán.

**Tiêu chí nghiệm thu**
- [ ] AC1: Quán bị tắt active → không đăng nhập partner được, không xuất hiện trong danh sách.

**Test bắt buộc:** HTTP test quyền + lọc active.

**File dự kiến:** `packages/modules/billing/**`.

**Contract / Event:** Migration `billing.partners`, `billing.partner_staff`.

**Ghi chú:** Nếu sau này đặt hẹn cần module riêng, tách `partner` ra khỏi billing (ghi vào ARCHITECTURE).

---

### BE-S4-07 · Đối soát ledger hằng ngày

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| billing | application, infrastructure | P2 | 1d | BE-S4-04, BE-S4-05 | — | TODO |

**Mục tiêu:** Phát hiện sớm lệch tiền.

**Phạm vi**
- Trong: Job hằng ngày: tổng `CHARGE − REFUND` khớp số payment SUCCEEDED chưa refund; voucher ISSUE = ACTIVE + RESERVED + REDEEMED + VOID + EXPIRED; lệch → log error + bản ghi `billing.reconciliation_reports`; query admin xem báo cáo.
- Ngoài: Đối soát với sao kê cổng thanh toán.

**Tiêu chí nghiệm thu**
- [ ] AC1: Cố tình chèn ledger lệch trong test → báo cáo đánh dấu mismatch.

**Test bắt buộc:** Integration.

**File dự kiến:** `packages/modules/billing/**`, `apps/worker/src/jobs/**`.

**Contract / Event:** Migration `billing.reconciliation_reports`.

**Ghi chú:** —
