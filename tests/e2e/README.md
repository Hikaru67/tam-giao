# E2E toàn luồng (BE-S7-09)

Kiểm thử đầu-cuối qua HTTP/WebSocket công khai của API: **2 người dùng + 1 chuyên viên**, mọi nhà cung cấp là Fake
(SMS console, eKYC fake, cổng thanh toán fake). Không import code ứng dụng → chạy lại được trên staging chỉ bằng
biến môi trường.

| # | Bước | API |
|---|---|---|
| 1 | Đăng ký OTP (đọc mã từ log SMS giả) | `POST /auth/otp/request`, `/auth/otp/verify` |
| 2 | Hồ sơ (ảnh qua presigned PUT) + tiêu chí | `POST /uploads`, `PUT /me/profile`, `PUT /me/preferences` |
| 3 | Thanh toán xác thực — webhook **tự ký** HMAC (vai cổng) | `POST /me/payments/verification`, `POST /webhooks/payments/fake` |
| 4 | Nộp eKYC (4 ảnh) | `POST /me/kyc` |
| 5 | Chuyên viên đăng nhập (mật khẩu + TOTP), nhận hồ sơ, đạt 4 bước, duyệt | `/admin/auth/login`, `/admin/kyc/submissions/:id/*` |
| 6 | Tạo quán + nhân viên, nhân viên đăng nhập PIN | `POST /admin/partners`, `/admin/partners/:id/staff`, `/partner/auth/login` |
| 7 | Chuyên viên ghép A–B | `POST /admin/matches` |
| 8 | Hai phía đồng ý → `DATING` | `POST /me/match/accept`, `GET /me/match` |
| 9 | Chat realtime A ↔ B | `GET /me/conversations`, WS `/ws`, `GET /me/conversations/:id/messages` |
| 10 | A đặt lịch tại quán, B xác nhận → voucher của A `ACTIVE` | `POST /me/dates`, `/me/dates/:id/confirm`, `GET /me/vouchers` |
| 11 | Nhân viên quét QR voucher (lần 2 → 409) | `GET /me/vouchers/:id/qr`, `POST /partner/vouchers/redeem` |
| 12 | Hai bên đánh giá `A_COMMIT` (sau giờ bắt đầu buổi hẹn) | `POST /me/dates/:id/feedback` |
| 13 | Match `CLOSED_SUCCESS` | `GET /admin/matches?status=CLOSED_SUCCESS` |

Thanh toán đứng **trước** nộp eKYC vì API chặn nộp khi chưa thanh toán (`PAYMENT_REQUIRED`, BE-S4-03). Các bước phụ
thuộc worker (outbox → consumer) được thăm dò tới `E2E_EVENT_TIMEOUT_MS`.

## Chạy trên máy local

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"   # Docker Desktop macOS
tests/e2e/run-local.sh up     # compose `tamgiao-e2e` (Postgres/Redis/SeaweedFS, cổng 55433/56380/58333, DB trống)
                              # + migrate + seed chuyên viên (ADMIN, mật khẩu/TOTP ngẫu nhiên → .run/admin.env)
                              # + api (cổng 3100) và worker chạy nền bằng node/tsx, log ở tests/e2e/.run/
tests/e2e/run-local.sh e2e    # e2e toàn luồng
tests/e2e/run-local.sh down   # dừng api/worker, xoá hạ tầng
```

Cấu hình api/worker local: `tests/e2e/local.env` (giá trị chỉ dùng local; bật `TRUST_PROXY=true` để seed tải gửi
`x-forwarded-for` riêng từng người dùng ảo — tránh hạn mức OTP 5 lần/giờ/IP).

## Chạy lại trên staging

```bash
E2E_BASE_URL=https://api.staging.example.vn \
E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… E2E_ADMIN_TOTP_SECRET=… \
E2E_OTP_COMMAND='ssh deploy@host "cd /opt/tamgiao && docker compose logs --since 10m api"' \
E2E_WEBHOOK_SECRET=<PAYMENT_WEBHOOK_SECRET của staging> \
  pnpm --filter @tamgiao/e2e e2e
```

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:3100` | Gốc API (WS suy ra `ws(s)://…/ws`) |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `E2E_ADMIN_TOTP_SECRET` | — (bắt buộc) | Tài khoản chuyên viên role `ADMIN` (tạo bằng `pnpm --filter @tamgiao/tools seed:admin`; secret lấy từ URI `otpauth://`) |
| `E2E_OTP_LOG_FILE` / `E2E_OTP_COMMAND` | — (một trong hai) | Nguồn log stdout của API chứa `[sms:dev] …` |
| `E2E_WEBHOOK_SECRET` | trống → dùng `POST /dev/payments/fake/:orderId` | `PAYMENT_WEBHOOK_SECRET` để tự ký webhook |
| `E2E_PAYMENT_GATEWAY` | `fake` | Tên cổng trong `/webhooks/payments/:gateway` |
| `E2E_FORWARDED_FOR` | `false` (`run-local.sh`: `true`) | Gửi `x-forwarded-for` giả mỗi người dùng (chỉ có tác dụng khi `TRUST_PROXY=true`) |
| `E2E_EVENT_TIMEOUT_MS` | `30000` | Thời gian chờ tối đa bước phụ thuộc worker |
| `E2E_DATE_LEAD_SECONDS` | `20` | Buổi hẹn bắt đầu sau N giây (đánh giá chỉ mở sau giờ bắt đầu) |

Staging dùng provider giả với `NODE_ENV=development` (docs/runbooks/staging-deploy.md) nên mọi bước trên chạy được.
Mỗi lần chạy tạo 2 người dùng + 1 quán mới (tên có hậu tố ngẫu nhiên), không dọn dữ liệu.

**Sau BE-S7-07 (rate limit toàn cục):** e2e chỉ gửi vài chục request nên thường không vướng; seed tải (`seed-load.ts`)
và k6 gửi hàng nghìn request từ một IP — cần `RATE_LIMIT_ENABLED=false` (đã đặt trong `local.env`) hoặc nâng
`RATE_LIMIT_GLOBAL_PER_MINUTE` / `RATE_LIMIT_OTP_PER_MINUTE` / `RATE_LIMIT_LOGIN_PER_MINUTE` trước khi chạy. Trên staging, `x-forwarded-for` giả **không** có tác dụng (reverse proxy ghi IP thật vào cuối
chuỗi, API lấy phần tử cuối) → hạn mức OTP 5 lần/giờ/IP chặn seed hàng trăm người dùng từ một máy: cần nới hạn mức cho
môi trường kiểm thử hoặc seed từ nhiều IP. Xem `tests/load/README.md`.
