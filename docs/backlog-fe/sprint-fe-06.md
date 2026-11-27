# Sprint FE-06 — Hoàn thiện & phát hành

**Mục tiêu sprint:** E2E toàn luồng trên 3 app, giám sát lỗi không PII, gia cố bảo mật FE, build thử nghiệm
(TestFlight / Google Play Internal) và web admin/partner trên staging.

**Demo cuối sprint:** Luồng 14 bước chạy bằng app thật trên máy test + web admin + partner, nối với staging (hoặc BE
local nếu D5 chưa xong).

**Nhóm chạy song song:** (01, 02, 03, 04) → (05)

---

### FE-S6-01 · E2E mobile (Maestro)

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile, tests | devops | P0 | 2d | FE-S5 | FE-S6-02, FE-S6-03, FE-S6-04 | DONE |

**Mục tiêu:** Luồng chính mobile được kiểm tra tự động trên BE local với provider giả.

**Phạm vi**
- Trong: flow Maestro: đăng nhập OTP → hồ sơ → thanh toán giả → eKYC (ảnh mẫu) → (admin duyệt qua API) → gợi ý → đồng ý →
  chat → đặt lịch → đánh giá; seed bằng FE-S1-05; chạy trong CI (emulator Android) hoặc đêm.
- Ngoài: Thiết bị thật đa dạng.

**Tiêu chí nghiệm thu**
- [ ] AC1: Flow pass 3 lần liên tiếp trên CI.

**Test bắt buộc:** Chính task này.

**File dự kiến:** `apps/mobile/e2e/**`, `.github/workflows/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S6-02 · E2E web admin + partner (Playwright)

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| admin, partner, tests | devops | P0 | 1.5d | FE-S5 | FE-S6-01, FE-S6-03, FE-S6-04 | DONE |

**Mục tiêu:** Luồng chuyên viên và quán được kiểm tra tự động.

**Phạm vi**
- Trong: admin: đăng nhập TOTP (secret seed) → duyệt eKYC → đề xuất ghép → xử lý báo cáo; partner: đăng nhập → redeem
  (camera giả / nhập tay); chạy trong CI.
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: Playwright pass trên Chromium + WebKit.

**Test bắt buộc:** Chính task này.

**File dự kiến:** `apps/admin/e2e/**`, `apps/partner/e2e/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S6-03 · Gia cố bảo mật & quyền riêng tư FE

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile, admin, partner | presentation, devops | P0 | 1.5d | FE-S5 | FE-S6-01, FE-S6-02, FE-S6-04 | DONE |

**Mục tiêu:** Rà soát luật F4/F5 trước khi phát hành.

**Phạm vi**
- Trong: rà token storage; chặn chụp màn hình ở eKYC/chat/thẩm định; xác thực deep link (chỉ route khai báo, id hợp lệ);
  CSP + header cho admin/partner; script grep tìm `console.log`/log có PII trong bundle; không có URL/secret dev trong build production.
- Ngoài: Pentest bên thứ ba.

**Tiêu chí nghiệm thu**
- [ ] AC1: Test tự động fail nếu bundle production chứa route `/dev/` hoặc nút thanh toán giả.

**Test bắt buộc:** Test meta trên bundle build.

**File dự kiến:** `tools/security/**`, `apps/*/src/**` (sửa nhỏ).

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S6-04 · Giám sát lỗi & analytics không PII

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile, admin, partner | infrastructure | P1 | 1d | FE-S5 | FE-S6-01, FE-S6-02, FE-S6-03 | DONE |

**Mục tiêu:** Biết app lỗi ở đâu mà không thu PII.

**Phạm vi**
- Trong: Sentry (React Native + browser) với scrub giống BE (SĐT, CCCD, email, token, nội dung tin); gắn `traceId` từ
  `ApiError` để đối chiếu log BE; no-op khi thiếu DSN; sự kiện funnel tối thiểu (bước onboarding) không kèm định danh.
- Ngoài: Công cụ analytics bên thứ ba (chờ PO + pháp lý).

**Tiêu chí nghiệm thu**
- [ ] AC1: Test scrub: chuỗi có SĐT/CCCD/JWT bị che trước khi gửi.

**Test bắt buộc:** Unit scrub.

**File dự kiến:** `packages/observability-fe/**` hoặc `apps/*/src/observability/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S6-05 · Build & phát hành thử nghiệm

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile, admin, partner, repo | devops | P0 | 1.5d | FE-S6-01…04 | — | BLOCKED |

**Lý do BLOCKED:** cấu hình build/deploy đã xong; AC1 (cài bản preview + đăng nhập staging) chờ PO cấp tài khoản Apple Developer, Google Play Console, Expo (EAS) và hạ tầng staging (D5).

**Mục tiêu:** QA và PO dùng được app trên máy thật.

**Phạm vi**
- Trong: EAS Build profile `preview`/`production`, credentials push (APNs/FCM), bundle id, icon/splash từ thiết kế; nộp
  TestFlight + Google Play Internal; deploy admin/partner (static) lên staging cùng BE (BE-S7-08); cấu hình env theo môi
  trường; quy trình tăng version; tài liệu `docs/runbooks/fe-release.md`.
- Ngoài: Phát hành công khai trên store (chờ PO + pháp lý: chính sách quyền riêng tư, điều khoản).

**Tiêu chí nghiệm thu**
- [ ] AC1: Bản build preview cài được và đăng nhập được vào staging (hoặc BE local qua tunnel nếu D5 chưa có).

**Test bắt buộc:** Smoke sau deploy web.

**File dự kiến:** `apps/mobile/eas.json`, `apps/mobile/app.config.ts`, `.github/workflows/deploy-fe-*.yml`, `docs/runbooks/fe-release.md`.

**Contract / Event:** Không có.

**Ghi chú:** Cần tài khoản Apple Developer + Google Play Console (PO cung cấp). Phụ thuộc D5 cho staging.
