# Hướng dẫn môi trường Dev FE — Tâm Giao

Tài liệu hướng dẫn khởi động Backend local với mock/fake provider và tạo dữ liệu mẫu theo kịch bản cho các ứng dụng Frontend (`mobile`, `admin`, `partner`).

---

## 1. Yêu cầu tiên quyết

- **Docker Desktop** (hoặc Docker Engine + Compose v2).
  > [!TIP]
  > Trên macOS, nếu gặp lỗi `docker-credential-desktop`, thêm đường dẫn sau vào biến môi trường:
  > ```bash
  > export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
  > ```
- **Node.js**: `>= 22.12`
- **pnpm**: `>= 12.0`

---

## 2. Thiết lập môi trường lần đầu

1. Tạo file `.env` từ `.env.example`:
   ```bash
   cp .env.example .env
   ```
   Các giá trị trong `.env.example` đã được cấu hình sẵn cho môi trường local (Postgres port 5433, Redis port 6380, SeaweedFS port 8333, các provider giả lập SMS console, fake eKYC, fake payment).

2. Cài đặt dependencies (nếu chưa):
   ```bash
   pnpm install
   ```

---

## 3. Khởi động Backend local (`pnpm dev:fe`)

Chạy lệnh duy nhất để khởi động toàn bộ hạ tầng và backend:

```bash
pnpm dev:fe
```

Lệnh này sẽ tự động:
1. Chạy `docker compose up -d` (PostgreSQL 16, Redis 7, SeaweedFS S3-compatible).
2. Chờ PostgreSQL sẵn sàng (thăm dò qua `pg_isready`, tối đa 60 giây).
3. Chạy database migration (`pnpm db:migrate`).
4. Khởi chạy song song `apps/api` (cổng 3000) và `apps/worker` với `RATE_LIMIT_ENABLED=false`.
5. Thiết lập `trap` bắt tín hiệu: khi nhấn **Ctrl+C**, cả hai tiến trình API và Worker sẽ được dừng an toàn.

### Các URL dịch vụ:
- **API Base URL**: `http://localhost:3000`
- **Tài liệu API (Swagger UI)**: `http://localhost:3000/docs`
- **Admin Web**: `http://localhost:5173`
- **Partner Web**: `http://localhost:5174`

---

## 4. Seed dữ liệu theo kịch bản (`pnpm seed:fe <scenario>`)

Mở một tab terminal khác và chạy lệnh seed tương ứng với giai đoạn màn hình cần test:

```bash
pnpm seed:fe <scenario>
```

Nếu không truyền tham số hoặc tham số sai, lệnh sẽ in danh sách hợp lệ và thoát với mã lỗi 2.

### Bảng kịch bản kiểm thử

| Kịch bản | Mô tả dữ liệu được tạo | Màn hình tương ứng trong `docs/backlog-fe` |
|---|---|---|
| `onboarded` | 1 user đã đăng nhập OTP, hoàn tất tạo hồ sơ và tiêu chí bạn đời (chưa thanh toán). | `FE-S2-01` (Đăng nhập/OTP), `FE-S2-03` (Hồ sơ cá nhân), `FE-S2-04` (Tiêu chí bạn đời), `FE-S3-01` (Thanh toán phí xác thực). |
| `verified` | 1 user đã thanh toán phí (cổng giả) + nộp eKYC (fake) + admin duyệt hồ sơ → trạng thái `ACTIVE`. | `FE-S3-04` (Hồ sơ đang thẩm định), `FE-S3-06` (Admin duyệt eKYC), trạng thái sẵn sàng ghép đôi. |
| `offered` | 2 user (1 nam, 1 nữ) đã verify + admin gửi đề xuất ghép đôi → trạng thái `OFFERED`. | `FE-S4-01` (Gợi ý ghép đôi độc quyền), `FE-S4-02` (Chờ phản hồi), `FE-S4-03` (Chi tiết hồ sơ đối phương). |
| `dating` | 2 user ở kịch bản `offered` và cả 2 bên cùng nhấn Đồng ý → trạng thái `DATING` + hội thoại chat realtime đã mở. | `FE-S4-04` (Trò chuyện WebSocket), `FE-S4-05` (Hộp thư / Danh sách hội thoại), `FE-S4-06` (Báo cáo vi phạm), `FE-S5-01` (Lên lịch hẹn). |
| `date-confirmed` | Cặp `dating` + User A gửi đề xuất lịch hẹn tại quán đối tác đang hoạt động (tự động tạo quán nếu chưa có) + User B xác nhận → trạng thái `DATE_CONFIRMED` + voucher của User A `ACTIVE`. | `FE-S5-01`/`FE-S5-03` (Xem chi tiết lịch hẹn đã xác nhận), `FE-S5-06` (Partner PWA quét QR đổi voucher), `FE-S5-04` (Đánh giá sau buổi hẹn). |

### Kết quả in ra sau khi seed
Script sẽ in ra bảng markdown gồm:
- Danh sách SĐT test, User ID, trạng thái.
- Thông tin Admin Dev (Email, mật khẩu mặc định, TOTP secret và TOTP URI).
- Tuyệt đối không in token truy cập bí mật ra màn hình.

---

## 5. Lấy mã OTP và đăng nhập

### Người dùng app (Mobile):
- Kênh gửi SMS ở môi trường dev được cấu hình `SMS_PROVIDER=console`.
- Khi bấm gửi OTP trên ứng dụng Mobile, hãy nhìn vào cửa sổ terminal đang chạy `pnpm dev:fe`.
- Tìm dòng log có dạng:
  ```text
  [sms:dev] to=+84912345678 text=Ma OTP cua ban la 123456...
  ```
- Nhập mã 6 số đó vào màn hình OTP trên app.

### Đăng nhập Admin (Web Admin):
- Truy cập `http://localhost:5173`.
- Nhập Email và Mật khẩu admin dev được in ra từ `pnpm seed:fe` (mặc định: `dev-admin@tamgiao.test` / `DevAdmin@123456`).
- Bước xác thực 2FA (TOTP): Thêm tài khoản vào ứng dụng Google Authenticator / 1Password / Authy bằng chuỗi `TOTP URI` (`otpauth://...`) hoặc nhập trực tiếp `TOTP Secret` được in ra ở cuối script seed.

---

## 6. Chạy 3 ứng dụng Frontend

Trong các tab terminal riêng biệt:

- **Mobile App (Expo)**:
  ```bash
  pnpm --filter @tamgiao/mobile dev
  ```
  Nhấn `i` để mở iOS Simulator, `a` để mở Android Emulator, hoặc quét mã QR qua app Expo Go.

- **Web Admin (Vite + React)**:
  ```bash
  pnpm --filter @tamgiao/admin dev
  ```
  Mở trình duyệt tại `http://localhost:5173`.

- **Web Partner (Vite + React PWA)**:
  ```bash
  pnpm --filter @tamgiao/partner dev
  ```
  Mở trình duyệt tại `http://localhost:5174`.

---

## 7. Rate Limiting khi dev

- Backend có middleware rate limiting (BE-S7-07) mặc định giới hạn request theo IP.
- Script `pnpm dev:fe` đã thiết lập sẵn `RATE_LIMIT_ENABLED=false` để quá trình phát triển UI và seed dữ liệu hàng loạt không bị giới hạn 429 (`TOO_MANY_REQUESTS`).

---

## 8. Xử lý lỗi thường gặp

1. **Docker chưa khởi động hoặc kết nối daemon thất bại**:
   - Triệu chứng: `Cannot connect to the Docker daemon` hoặc `docker compose up -d` báo lỗi.
   - Khắc phục: Mở ứng dụng **Docker Desktop** trên máy và chờ chuyển sang trạng thái running (icon màu xanh).

2. **Lỗi `docker-credential-desktop` trên macOS**:
   - Triệu chứng: `error getting credentials - err: exec: "docker-credential-desktop": executable file not found in $PATH`.
   - Khắc phục:
     ```bash
     export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
     ```
     hoặc thêm dòng trên vào `~/.zshrc` / `~/.bashrc`.

3. **Port bị xung đột (5433, 6380, 8333, 3000)**:
   - Triệu chứng: `bind: address already in use`.
   - Khắc phục: Kiểm tra các tiến trình đang chiếm cổng bằng `lsof -i :<port>` và tắt chúng trước khi chạy `pnpm dev:fe`.


## Hạn mức OTP khi seed

`pnpm dev:fe` chạy API với `RATE_LIMIT_ENABLED=false` và `TRUST_PROXY=true` (chỉ dev). `seed:fe` gán IP giả
(`x-forwarded-for`) cho từng user ảo để không vướng hạn mức OTP theo IP của identity. Không dùng cấu hình này ngoài máy dev.

---

## 9. E2E mobile (Maestro) — FE-S6-01

Kiểm thử tự động luồng chính của app mobile (`apps/mobile`, Android package `vn.tamgiao.app`) bằng **Maestro** trên Android emulator kết nối với Backend local (`tests/e2e/run-local.sh`).

### Yêu cầu
- Android SDK + Android Emulator (hoặc thiết bị Android kết nối qua `adb`)
- Maestro CLI (`curl -fsSL https://get.maestro.mobile.dev | bash`, CI đang ghim phiên bản `1.41.0`)
- Java 17
- Docker (để chạy Postgres, Redis, SeaweedFS cho BE local)

### Kiến trúc & danh sách flow
- **Người dùng A** (nam) thao tác trực tiếp qua UI của app trên emulator.
- **Người dùng B** (nữ, đối phương), chuyên viên và quán đối tác do **helper** (`apps/mobile/e2e/helper/server.ts`, cổng mặc định `3199`) thực hiện qua API, tái dùng thư viện `tests/e2e/src/lib` (cùng cơ chế seed như `pnpm seed:fe verified`).
- Maestro gọi helper thông qua `runScript` (`apps/mobile/e2e/scripts/helper-step.js`), nhận về các biến `output.*` theo contract trong `apps/mobile/e2e/helper/steps.ts`.

| Đường dẫn | Vai trò |
|---|---|
| `apps/mobile/e2e/flows/full-journey.yaml` | Flow tổng, chạy toàn bộ hành trình người dùng A |
| `apps/mobile/e2e/flows/subflows/01-login-otp` … `09-feedback` | Các flow con theo từng chặng (đăng nhập OTP → hồ sơ → tiêu chí → thanh toán → eKYC → gợi ý & đồng ý → chat → đặt lịch → đánh giá) |

### Các bước chạy ngoài UI và lý do
- **Ảnh hồ sơ**: helper upload và điền sẵn nháp qua API trước khi A mở app, vì picker ảnh hệ thống của Android không tự động hoá ổn định.
- **Thanh toán**: app tạo đơn khi bấm nút thanh toán, sau đó helper gửi webhook có chữ ký (đóng vai cổng thanh toán) vì bản build release không có panel `__DEV__`.
- **Thẩm định & ghép đôi**: chuyên viên duyệt eKYC và đề xuất ghép đôi A–B qua API.
- **Tương tác phía B**: B đồng ý ghép đôi, gửi tin nhắn qua WebSocket và đánh giá `A_COMMIT` qua API.
- **Đặt lịch hẹn**: B từ chối lịch A vừa đặt và đề xuất lại lịch mới tại quán đối tác bắt đầu sau `E2E_DATE_LEAD_SECONDS` (mặc định `90` giây) để A xác nhận trên UI và mở được bước đánh giá ngay sau giờ bắt đầu.
- **Chụp ảnh eKYC**: app chụp ảnh bằng camera giả của emulator (`-camera-back emulated -camera-front emulated`).

### Chạy trên máy local

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
tests/e2e/run-local.sh up                                   # BE cổng 3100 + worker + chuyên viên seed
export EXPO_PUBLIC_API_URL=http://10.0.2.2:3100 EXPO_PUBLIC_WS_URL=ws://10.0.2.2:3100/ws
pnpm --filter @tamgiao/mobile exec expo prebuild --platform android --no-install --clean
# + bật cleartext trong apps/mobile/android/app/src/main/AndroidManifest.xml như step "Allow cleartext" của workflow
(cd apps/mobile/android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64)
apps/mobile/e2e/run.sh ci apps/mobile/android/app/build/outputs/apk/release/app-release.apk   # hoặc: helper-start → test N → helper-stop
tests/e2e/run-local.sh down
```

Script `apps/mobile/e2e/run.sh` hỗ trợ các lệnh `helper-start`, `helper-stop`, `test [N]` và `ci <apk>` (`ci` tự động khởi động helper, cài APK, `adb reverse tcp:58333 tcp:58333`, chạy `flows/full-journey.yaml` 3 lần liên tiếp và dừng ở lần fail đầu tiên, sau đó tắt helper). Log và báo cáo JUnit/debug được ghi trong `apps/mobile/e2e/.run/` (`helper.log`, `report-<i>.xml`, `debug-<i>/`).

### Chạy trên CI
- Workflow `.github/workflows/e2e-mobile.yml` chạy tự động mỗi đêm lúc 02:00 giờ Việt Nam (`0 19 * * *` UTC) và hỗ trợ chạy tay:
  ```bash
  gh workflow run e2e-mobile.yml --ref <nhánh>
  gh run watch
  ```
- Khi run thất bại, tải artifact `e2e-mobile-logs` để xem log helper/API/worker, báo cáo JUnit và ảnh chụp/debug của Maestro.

### Test meta (không cần emulator)
Chạy trong `pnpm test` để kiểm tra nhanh trên CI/local:
- Mọi file YAML trong `apps/mobile/e2e/flows/**` parse hợp lệ.
- Mọi selector `id:` trong flow đều khớp với `testID` có thật trong mã nguồn app.
- Các flow con được `flows/full-journey.yaml` gọi đầy đủ và đúng thứ tự.
- Tên bước helper và biến `${output.*}` khớp với registry `apps/mobile/e2e/helper/steps.ts`.

### Biến môi trường helper

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `E2E_HELPER_PORT` | `3199` | Cổng HTTP của server helper trên máy host |
| `E2E_DATE_LEAD_SECONDS` | `90` | Số giây sau hiện tại mà B đề xuất giờ bắt đầu buổi hẹn |
| `E2E_EVENT_TIMEOUT_MS` | `60000` | Thời gian chờ tối đa (ms) cho các bước bất đồng bộ qua worker/WebSocket |

Các biến kết nối BE (`E2E_BASE_URL`, `E2E_ADMIN_*`, `E2E_OTP_LOG_FILE`, `E2E_WEBHOOK_SECRET`, …) dùng giống [tests/e2e/README.md](../../tests/e2e/README.md).
