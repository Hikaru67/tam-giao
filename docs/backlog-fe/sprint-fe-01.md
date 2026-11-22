# Sprint FE-01 — Nền móng FE

**Mục tiêu sprint:** 3 app FE chạy trong monorepo, dùng chung design tokens, api-client typed theo `@tamgiao/contracts`,
CI kiểm tra FE. Chưa có màn nghiệp vụ.

**Demo cuối sprint:** `pnpm dev` chạy BE + mobile (Expo Go/simulator) + admin + partner; màn "health" của mỗi app gọi
`GET /health` qua api-client; trang Storybook hiện bộ component cơ bản theo token.

**Nhóm chạy song song:** (01) → (02, 03, 05) → (04, 06, 07)

---

### FE-S1-01 · Khởi tạo apps/mobile, apps/admin, apps/partner trong monorepo

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| mobile, admin, partner, repo | devops | P0 | 1.5d | — | — | DONE |

**Mục tiêu:** Có khung 3 app theo FE-D1/FE-D2 để các task sau chỉ thêm màn.

**Phạm vi**
- Trong: `apps/mobile` (Expo SDK hiện hành, Expo Router, TypeScript strict, NativeWind); `apps/admin`, `apps/partner`
  (Vite + React + TS strict + TanStack Router/Query + Tailwind; partner bật PWA manifest); script `dev`/`build`/`typecheck`/
  `test` cho turbo; ESLint/Prettier dùng config gốc (thêm preset React/RN nếu cần); env qua `app.config.ts` / `import.meta.env`
  (chỉ `API_URL`, `WS_URL`, không secret); màn placeholder.
- Ngoài: Màn nghiệp vụ, design tokens (FE-S1-02), api-client (FE-S1-03).

**Tiêu chí nghiệm thu**
- [ ] AC1: `pnpm typecheck`, `pnpm lint`, `pnpm test` ở root bao gồm 3 app và pass.
- [ ] AC2: `pnpm --filter @tamgiao/admin dev` và `--filter @tamgiao/partner dev` mở được; mobile chạy trên iOS simulator hoặc Android emulator.
- [ ] AC3: Không app nào import `packages/modules/*`, `packages/db`, `packages/http` (ESLint chặn); chỉ được import `@tamgiao/contracts` và package FE.

**Test bắt buộc:** 1 test render placeholder mỗi app; test ESLint boundary (file vi phạm → lỗi).

**File dự kiến:** `apps/mobile/**`, `apps/admin/**`, `apps/partner/**`, `eslint.config.js`, `turbo.json`, `pnpm-workspace.yaml` (nếu cần), `.env.example`.

**Contract / Event:** Không có.

**Ghi chú:** Ghim phiên bản chính xác (không `^`), giống package BE. `@tamgiao/contracts` phải dùng được ở RN/web (không phụ thuộc Node).

---

### FE-S1-02 · Design tokens + font từ DESIGN.md

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| packages/ui-tokens | presentation | P0 | 1d | FE-S1-01 | FE-S1-03, FE-S1-05 | DONE |

**Mục tiêu:** Một nguồn token (màu, chữ, bo góc, khoảng cách) cho cả mobile và web, khớp thiết kế Stitch.

**Phạm vi**
- Trong: `packages/ui-tokens` sinh từ `design/stitch/t_m_giao_matchmaking_system/DESIGN.md` (colors, typography, rounded,
  spacing); xuất preset Tailwind + NativeWind; font Be Vietnam Pro (expo-font / Google Fonts self-host); script kiểm tra
  token khớp DESIGN.md.
- Ngoài: Component (FE-S1-07), dark mode (không có trong thiết kế).

**Tiêu chí nghiệm thu**
- [ ] AC1: Mọi màu/chữ/khoảng cách trong DESIGN.md có token cùng tên.
- [ ] AC2: Test fail nếu DESIGN.md đổi mà token chưa cập nhật.

**Test bắt buộc:** Unit đối chiếu token ↔ DESIGN.md.

**File dự kiến:** `packages/ui-tokens/**`, preset Tailwind trong `apps/*/tailwind.config.*`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S1-03 · api-client typed theo contracts (REST + làm mới token)

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| packages/api-client | infrastructure | P0 | 2d | FE-S1-01 | FE-S1-02, FE-S1-05 | DONE |

**Mục tiêu:** Mọi app gọi BE qua một client có kiểu, parse bằng Zod của contracts, xử lý lỗi và phiên thống nhất (luật F1).

**Phạm vi**
- Trong: wrapper `fetch` (base URL, `x-request-id`, timeout, JSON); parse response bằng schema contracts; Problem JSON →
  `ApiError { code, status, traceId, meta }`; làm mới token khi 401 (`POST /auth/refresh`, xoay vòng, một request refresh
  tại một thời điểm, refresh hỏng → phát sự kiện "đăng xuất"); adapter lưu token do app truyền vào (SecureStore / bộ nhớ);
  hook TanStack Query mẫu; upload presigned (`POST /uploads` → PUT lên URL trả về).
- Ngoài: WebSocket chat (FE-S4-04), thông điệp lỗi (FE-S1-04).

**Tiêu chí nghiệm thu**
- [ ] AC1: Response sai schema → lỗi `RESPONSE_INVALID` (không crash màn).
- [ ] AC2: 5 request đồng thời nhận 401 → chỉ 1 lần gọi refresh, cả 5 được gửi lại.
- [ ] AC3: Refresh token bị thu hồi → xoá token, phát sự kiện đăng xuất.

**Test bắt buộc:** Unit với MSW: parse, lỗi, refresh đồng thời, upload.

**File dự kiến:** `packages/api-client/**`.

**Contract / Event:** Không có (dùng schema sẵn có của `@tamgiao/contracts`).

**Ghi chú:** Route thiếu schema response trong contracts → ghi vào "Việc phát sinh" (thêm schema ở contracts là việc được phép, chỉ thêm).

---

### FE-S1-04 · Bảng thông điệp lỗi tiếng Việt theo mã lỗi

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| packages/api-client | presentation | P0 | 0.5d | FE-S1-03 | FE-S1-06, FE-S1-07 | TODO |

**Mục tiêu:** Người dùng thấy câu tiếng Việt dễ hiểu cho mọi mã lỗi BE (luật F3).

**Phạm vi**
- Trong: map `code` → thông điệp (+ hành động gợi ý) cho mọi mã trong `packages/contracts/src/errors.ts`; thông điệp mặc định; nội suy `meta` (vd số giây chờ OTP).
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: Test fail nếu có mã lỗi trong contracts chưa có thông điệp.

**Test bắt buộc:** Unit phủ toàn bộ mã lỗi.

**File dự kiến:** `packages/api-client/src/messages/**`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S1-05 · Môi trường dev FE: BE local + dữ liệu mẫu + API giả

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| repo, tests/e2e | devops | P0 | 1d | FE-S1-01 | FE-S1-02, FE-S1-03 | TODO |

**Mục tiêu:** Dev FE dựng được dữ liệu ở mọi giai đoạn (mới đăng ký, đã duyệt, đang ghép, đang hẹn) trong 1 lệnh.

**Phạm vi**
- Trong: script `pnpm dev:fe` (docker compose + migrate + api + worker với provider giả); script seed theo kịch bản
  (dùng lại `tests/e2e/src/lib/*`): `onboarded`, `verified`, `offered`, `dating`, `date-confirmed`, admin mặc định; in ra
  SĐT test + cách lấy OTP (log SMS giả); MSW handlers dùng chung cho test FE.
- Ngoài: Staging (D5).

**Tiêu chí nghiệm thu**
- [ ] AC1: `pnpm dev:fe && pnpm seed:fe dating` → 2 tài khoản đang ở giai đoạn DATING có hội thoại mở.

**Test bắt buộc:** Script seed chạy trong CI một lần (smoke).

**File dự kiến:** `tools/scripts/seed-fe.ts`, `tests/e2e/src/lib/**` (chỉ thêm), `package.json` (script), `packages/api-client/src/mocks/**`.

**Contract / Event:** Không có.

**Ghi chú:** Rate limit BE (BE-S7-07) tắt bằng `RATE_LIMIT_ENABLED=false` khi seed.

---

### FE-S1-06 · CI cho FE

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| repo | devops | P0 | 0.5d | FE-S1-01 | FE-S1-04, FE-S1-07 | TODO |

**Mục tiêu:** PR có FE được kiểm tra tự động như BE.

**Phạm vi**
- Trong: job CI typecheck/lint/test cho 3 app; `vite build` admin/partner; `expo export` (bundle) mobile; cache pnpm/turbo.
- Ngoài: Build store / deploy (FE-S6-05).

**Tiêu chí nghiệm thu**
- [ ] AC1: Lỗi type trong `apps/mobile` làm CI đỏ.

**Test bắt buộc:** —

**File dự kiến:** `.github/workflows/ci.yml`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### FE-S1-07 · Bộ component cơ bản + Storybook

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| packages/ui-mobile, packages/ui-web | presentation | P1 | 2d | FE-S1-02 | FE-S1-04, FE-S1-06 | TODO |

**Mục tiêu:** Các màn dựng từ component chung, đúng thiết kế (luật F6).

**Phạm vi**
- Trong: Button, TextField, OtpInput (6 ô), PhoneInput (+84), Card, Badge/Chip (xác thực), Avatar, Countdown (đếm ngược
  theo `expiresAt`), Stepper, Toast, Modal/BottomSheet, EmptyState, ErrorState (theo `ApiError`); bản mobile + web;
  Storybook (web) có story mỗi component.
- Ngoài: Component đặc thù màn (làm trong task màn).

**Tiêu chí nghiệm thu**
- [ ] AC1: Countdown dùng thời gian server (`expiresAt`), không tự tính lại TTL ở client.
- [ ] AC2: Component có nhãn accessibility.

**Test bắt buộc:** Unit render + tương tác cho OtpInput, Countdown, PhoneInput.

**File dự kiến:** `packages/ui-mobile/**`, `packages/ui-web/**`.

**Contract / Event:** Không có.

**Ghi chú:** —
