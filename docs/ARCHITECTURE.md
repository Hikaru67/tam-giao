# Kiến trúc Backend — Tâm Giao

Clean Architecture + Modular Monolith, TypeScript. Tài liệu này là nguồn chân lý về thiết kế;
luật bắt buộc rút gọn nằm ở `AGENTS.md` mục 2.

## 1. Tổng quan hệ thống

```
Mobile (Expo) ─┐
Admin (Next.js)├─ HTTPS / WebSocket ─► apps/api (Hono) ──┬─ PostgreSQL (schema theo module, outbox)
Partner web ───┘                                        ├─ Redis (pub/sub chat, từ Sprint 6)
                                                        ├─ Object storage S3 (bucket public-profile / private-kyc)
                      apps/worker (pg-boss) ◄── outbox ─┘
                      job hết hạn, relay event, push, retention
Bên ngoài: SMS OTP · eKYC · Cổng thanh toán · Push (Expo/FCM/APNs) · KMS
```

## 2. Các lớp và quy tắc phụ thuộc

```
infrastructure ─► application ─► domain ─► kernel
presentation   ─► application
(phụ thuộc chỉ hướng vào trong)
```

| Lớp | Chứa | Được import |
|---|---|---|
| `domain` | Aggregate, Entity, Value Object, Domain Service, Domain Event, mã lỗi | `@tamgiao/kernel`, `@tamgiao/contracts/constants` |
| `application` | Use case, Query, Port (interface), Facade cho module khác | `domain`, `kernel`, `contracts/constants`, `@tamgiao/module-<khác>/facade` |
| `infrastructure` | Repository (Drizzle), adapter bên ngoài, mapper, schema DB, job handler | tất cả ở trên + thư viện |
| `presentation` | Route Hono, WS handler, map DTO ↔ command, map lỗi → HTTP | `application`, `contracts` |

## 3. Cấu trúc repo

```
tam-giao/
  apps/
    api/src/          main.ts (composition root), config.ts, modules.ts, http/
    worker/src/       main.ts, config.ts, jobs/
    mobile/ admin/ partner/          (frontend — ngoài phạm vi backlog BE)
  packages/
    kernel/           Entity, AggregateRoot, DomainEvent, Result, Id, Clock, Money, UnitOfWork port
    contracts/        Zod DTO, mã lỗi, hằng số nghiệp vụ, event payload (dùng chung BE ↔ FE)
    db/               Drizzle client, Tx, DrizzleUnitOfWork, outbox, processed_events, migration
    http/             Bộ khung HTTP dùng chung cho apps/api và presentation của module: AppEnv, requestContext,
                      Problem JSON (`sendResult`, `problemResponse`), `parseBody`/`parseQuery`, middleware xác thực
    testing/          Testcontainers helper, factory, FakeClock re-export
    modules/
      identity/ profile/ verification/ billing/ matching/ messaging/ dating/ safety/ notification/
        domain/ application/{ports,use-cases,queries,facade.ts} infrastructure/ presentation/ __tests__/
  docs/
  design/             bản thiết kế Stitch (tham chiếu UI)
```

## 4. Module

| Module | Trách nhiệm | Mức độ |
|---|---|---|
| identity | OTP, session/JWT, admin user, 2FA, RBAC, audit log | đủ lớp |
| profile | Hồ sơ, ảnh, tiêu chí bạn đời, trạng thái onboarding | mỏng |
| verification | eKYC, duyệt độc thân, phỏng vấn sơ bộ | đủ lớp |
| billing | Thanh toán, ledger, hoàn tiền, voucher, partner | đủ lớp |
| matching | Gợi ý, máy trạng thái, độc quyền 1-1, cooldown, chấm điểm | đủ lớp (lõi) |
| messaging | Chat 14 ngày, lọc lừa đảo, che SĐT/link | đủ lớp |
| dating | Đặt hẹn, check-in an toàn, đánh giá sau gặp | đủ lớp |
| safety | Báo cáo vi phạm, khoá 2 chiều, kiểm duyệt | đủ lớp |
| notification | Push, SMS, template | mỏng |

Giao tiếp giữa module: **domain event qua outbox** (bất đồng bộ) hoặc **facade read-only** (đồng bộ).

### Event chính

| Event | Phát bởi | Tiêu thụ bởi |
|---|---|---|
| `PaymentSucceeded` | billing | verification (cho phép nộp), notification |
| `KycApproved` / `KycRejected` | verification | matching (đủ điều kiện), billing (hoàn tiền khi rejected), notification |
| `MatchOffered` / `MatchAwaitingResponse` | matching | notification |
| `MatchStartedDating` | matching | messaging (mở hội thoại), notification |
| `MatchClosed` (success/stopped/expired/locked) | matching | messaging (đóng hội thoại), notification |
| `DateConfirmed` | dating | billing (kích hoạt voucher), notification |
| `FeedbackSubmitted` | dating | matching (chuyển CLOSED_*) |
| `ReportFiled` | safety | matching (LOCKED), messaging (đóng), notification (alert chuyên viên) |

## 5. Máy trạng thái Match

```
OFFERED ──accept(1 bên)──► AWAITING_RESPONSE ──accept(bên còn lại)──► DATING ──date xong──► MET
  │ decline / hết 24h          │ decline / withdraw / hết 24h            │ stop / hết 14 ngày      │ feedback
  ▼                            ▼                                         ▼                         ▼
EXPIRED | DECLINED          DECLINED | EXPIRED                      CLOSED_STOPPED          CLOSED_SUCCESS (cả 2 chọn A)
                                                                     → COOLDOWN 7 ngày       CLOSED_STOPPED (≥1 chọn B)
Mọi trạng thái chưa đóng ──ReportFiled──► LOCKED
```

- **Độc quyền 1-1:** bảng `matching.active_slots(user_id PK, match_id)`. Tạo match = insert 2 dòng trong cùng `tx`; trùng → `USER_BUSY`. Đóng match = xoá 2 dòng.
- **Cooldown:** `matching.cooldowns(user_id PK, until)`.
- **Hết hạn:** mỗi lần chuyển trạng thái có hạn → `Scheduler.scheduleExpiry(tx, matchId, at)`; job gọi `ExpireMatch` (kiểm tra lại state + thời gian, idempotent).

## 6. Pattern hạ tầng

- **UnitOfWork:** `uow.run(async tx => …)` bọc `db.transaction`.
- **Outbox:** `outbox(id, event_type, payload, occurred_at, published_at)`; worker relay → EventBus nội bộ → handler; `processed_events(consumer, event_id)` đảm bảo idempotent.
- **Scheduler:** pg-boss, job key = `<type>:<aggregateId>:<version>` để không trùng.
- **Encryptor:** envelope encryption AES-256-GCM; master key từ KMS (local: env). Blind index HMAC-SHA256 cho tìm kiếm CCCD.
- **Storage:** presigned PUT/GET; bucket `public-profile` (ảnh hồ sơ, vẫn cần auth để lấy URL) và `private-kyc` (CCCD, selfie, bằng chứng). Port `ObjectStorage` + `UploadRegistry` ở `@tamgiao/kernel` (`storage.ts`), adapter `S3ObjectStorage` + `UploadService` ở `@tamgiao/db` (`storage/`). Luồng: app gọi `POST /uploads {purpose, contentType, sizeBytes}` → server kiểm tra MIME (jpeg/png/heic) và kích thước (≤ 10 MB) rồi ghi `platform.uploads` (`PENDING`) và trả presigned PUT có ký `content-type` + `content-length` (TTL `PRESIGNED_URL_TTL_SECONDS`) → app PUT thẳng lên storage → gửi `key` cho API nghiệp vụ → module gọi `uploads.verifyOwned(tx, {ownerId, key, purposes})` (sai chủ → `UPLOAD_NOT_OWNED`; sai mục đích / chưa tải lên / object khác khai báo → `UPLOAD_INVALID`; thành công → `CONFIRMED`). Key dạng `<purpose>/<ownerId>/<uploadId>.<ext>`, không chứa tên tệp gốc.
- **Hồ sơ (profile):** `PUT /me/profile` gửi toàn bộ form; `submit: false` = "Lưu tạm" (chấp nhận form dở, nhưng trường đã điền vẫn phải hợp lệ), `submit: true` = "Tiếp tục" (bắt buộc đủ trường, `PROFILE_INCOMPLETE` + `meta.missing`); lần hoàn tất đầu tiên phát `ProfileCompleted` qua outbox, hồ sơ đã hoàn tất không quay lại nháp. Tuổi tính theo ngày lịch Việt Nam (UTC+7) so với `MIN_AGE`. `photos` ≤ `MAX_PROFILE_PHOTOS`, phần tử đầu là ảnh đại diện, mỗi key xác nhận qua `UploadRegistry`. Thu nhập/nhà ở/tài sản lưu `*_enc` (context `profile.profiles.<cột>:<userId>`).
- **Tiêu chí bạn đời:** `profile.preferences` — bộ lọc cứng (`age_min`, `age_max`, `area_city`, `area_radius_km`, `children_plan`, `religion`, `min_education`) là cột riêng để matching lọc bằng SQL; lối sống, độc lập tài chính, 3 phẩm chất cốt lõi ở jsonb `details`. Giá trị `not_important` = bỏ qua tiêu chí. Mỗi lần lưu phát `PreferencesUpdated`.
- **Nộp eKYC (verification):** `POST /me/kyc {cccdFrontKey, cccdBackKey, selfieKey, maritalStatusCertificateKey}` (thiếu → `KYC_DOCS_MISSING` + `meta.missing`). Use case `SubmitKyc` chạy 2 transaction ngắn, gọi eKYC ở giữa (không giữ connection khi chờ nhà cung cấp): (1) kiểm tra hồ sơ còn được nộp (chưa có, hoặc `NEEDS_MORE_INFO` → nộp bổ sung; các trạng thái khác kể cả `REJECTED` → `KYC_ALREADY_SUBMITTED`) + `uploads.verifyOwned` (`kyc_doc` cho CCCD/giấy độc thân, `kyc_selfie` cho selfie); (2) gọi song song `ocrIdCard`/`checkLiveness`/`matchFace` qua `ResilientEkycProvider` — bị từ chối (ảnh mờ, không khớp) hay lỗi hạ tầng (timeout) đều **vẫn nộp**, kết quả từng thao tác + điểm lưu ở `ekyc_assessment` làm gợi ý; họ tên/ngày sinh OCR đối chiếu với facade profile (bỏ dấu, viết hoa, gộp khoảng trắng), lệch → cờ `profileMismatches`, không chặn; **không bước nào tự đánh `PASSED`** (chuyên viên quyết định); (3) khoá theo user (advisory lock) rồi lưu `verification.kyc_submissions` + `KycSubmitted` vào outbox. Số CCCD lưu `cccd_number_enc` (context `verification.kyc_submissions.cccd_number:<userId>`) + `cccd_number_bidx` UNIQUE (purpose `verification.cccd_number`); vi phạm unique (23505) map theo tên constraint → `CCCD_ALREADY_REGISTERED` / `KYC_ALREADY_SUBMITTED` (Result, không 500). `GET /me/kyc` luôn 200: `NOT_SUBMITTED` khi chưa nộp, đủ 4 bước theo thứ tự `CCCD_CHIP, MARITAL_STATUS, MANUAL_REVIEW, INTERVIEW`, mục cần bổ sung khi `NEEDS_MORE_INFO`; không trả số CCCD/điểm eKYC. Dev dùng `FakeEkycProvider({ deriveCccdFromKey: true })` để mỗi user có số CCCD giả khác nhau.
- **Phỏng vấn sơ bộ (verification):** bảng `verification.interview_slots` (slot `INTERVIEW_DURATION_MINUTES` phút, `OPEN → BOOKED → COMPLETED`, huỷ thì `BOOKED → OPEN`). Chuyên viên (`kyc:review`) mở slot `POST /admin/kyc/interview/slots {startsAt, meetingUrl?}` (không chồng giờ với slot khác của mình: advisory lock theo chuyên viên + unique `interviewer_id, starts_at` → `INTERVIEW_SLOT_OVERLAP`), xem nhật ký `GET /admin/kyc/interview/slots?status&from&to&limit`, ghi kết quả `PUT /admin/kyc/interview/:id/notes {outcome, notes}` — cùng transaction gọi `KycSubmission.markStep('INTERVIEW', outcome)` (hồ sơ đã quyết định → `KYC_ALREADY_DECIDED`); chỉ ghi khi slot đã đặt và đã tới giờ bắt đầu. Người dùng: `GET /me/kyc/interview/slots` (slot trống, không lộ chuyên viên/link), `GET|POST|PUT|DELETE /me/kyc/interview` (xem/đặt/đổi/huỷ). Chỉ đặt khi hồ sơ đã nộp và chưa quyết định (`INTERVIEW_REQUIRES_SUBMISSION`) và bước `INTERVIEW` chưa đạt. Đặt slot = `SELECT … FOR UPDATE` dòng slot → người sau nhận `SLOT_TAKEN`; mỗi người tối đa 1 lịch `BOOKED` = partial unique index `interview_slots_active_booking_uq` (`INTERVIEW_ALREADY_BOOKED`). Huỷ/đổi chỉ khi còn ≥ `INTERVIEW_CHANGE_CUTOFF_HOURS` giờ (đúng biên được phép, `CANCEL_TOO_LATE`); đổi lịch = huỷ + đặt trong cùng transaction, khoá 2 slot theo thứ tự id. Nhận xét có thể chứa PII: chỉ trả ở API admin, không log, không phát event.
- **`GET /me`:** module profile tổng hợp `onboardingStep`: `PROFILE` khi chưa có/nháp hồ sơ → `CRITERIA` khi chưa có tiêu chí → theo `VerificationFacade.getSummary` (`@tamgiao/module-verification/facade`, BE-S3-07): `VERIFICATION` khi chưa nộp eKYC (không có hồ sơ hoặc `DRAFT`), `UNDER_REVIEW` khi đã nộp chưa quyết định (`SUBMITTED`/`UNDER_REVIEW`/`NEEDS_MORE_INFO` — chi tiết ở `GET /me/kyc`), `ACTIVE` khi `APPROVED`, `REJECTED` khi bị từ chối. `badges` theo từng bước đã `PASSED` (`CCCD_CHIP` → `CCCD_VERIFIED`, `MARITAL_STATUS` → `SINGLE_VERIFIED`, `INTERVIEW` → `INTERVIEWED`), rỗng khi hồ sơ `REJECTED`. Facade verification read-only, mỗi lời gọi một transaction ngắn; `isVerified = status === APPROVED`. Composition root tạo verification trước profile, `applicants` của verification chuyển tiếp lười sang `profile.facade` (không phụ thuộc vòng giữa package). TODO(BE-S4-03): `UNDER_REVIEW` chỉ khi đã nộp eKYC **và** đã thanh toán (facade billing).
- **Duyệt eKYC (admin, verification):** route `/admin/kyc/submissions[...]`, xem (hàng chờ, chi tiết, `assign`) cần `kyc:review`, quyết định (`steps`, `approve`, `reject`, `request-more-info`) cần `kyc:decide`. Hàng chờ: mặc định `SUBMITTED,UNDER_REVIEW`, hồ sơ chờ lâu nhất trước (`submitted_at, id`, cursor), lọc `flagged` = có cờ eKYC (`ekycFlags()` ở domain: chưa có đánh giá / thao tác bị từ chối hoặc lỗi / lệch hoặc không đối chiếu được hồ sơ — SQL ở `DrizzleKycReviewQueue` viết lại cùng định nghĩa), tìm `q` theo tên/nghề qua facade profile (`searchUserIds`, `getApplicantSummaries`; port `ApplicantDirectory`). Chi tiết trả số CCCD đầy đủ + presigned GET 4 ảnh `privateKyc` và **ghi audit `kyc.view_detail` cùng transaction với lần đọc**. Mọi thao tác chuyên viên chạy `uow.run` → `findByIdForUpdate` (FOR UPDATE) → domain → `save` (event vào outbox) → audit cùng `tx` (`kyc.assign_reviewer`, `kyc.mark_step`, `kyc.approve`, `kyc.reject`, `kyc.request_more_info`; meta không PII); hai quyết định đồng thời → người sau `KYC_ALREADY_DECIDED`. Đánh `CCCD_CHIP` đạt khi chưa có số CCCD → `KYC_CCCD_NUMBER_MISSING`.
- **Xoá ảnh eKYC theo thời hạn lưu (verification, BE-S3-06):** job pg-boss `verification.kyc-media-retention` (worker, cron `KYC_MEDIA_RETENTION_CRON` mặc định `0 3 * * *`, múi giờ `KYC_MEDIA_RETENTION_TZ` mặc định `Asia/Ho_Chi_Minh`) gọi `PurgeExpiredKycMedia`: hồ sơ `APPROVED`/`REJECTED` có `decided_at < now − KYC_MEDIA_RETENTION_DAYS` (theo `Clock`) và còn key ảnh → **mỗi hồ sơ một transaction**: `SELECT … FOR UPDATE SKIP LOCKED` → kiểm tra lại luật domain (`isKycMediaRetentionExpired`) → `ObjectStorage.delete` cả 4 ảnh `privateKyc` (CCCD trước/sau, selfie, giấy xác nhận độc thân; idempotent) → đặt 4 cột key = NULL → audit `kyc.purge_media` (actor `system`, meta `{status, objectCount, retentionDays}`) cùng `tx`. Giữ nguyên trạng thái, các bước, `ekyc_assessment`, số CCCD mã hoá; không đổi `version`, không phát event. Port hẹp `KycMediaRetentionRepository` (không dựng aggregate → không giải mã CCCD). Sau khi xoá, aggregate có `documents = null`; chi tiết admin trả ảnh `null`. Idempotent: hồ sơ đã xoá không còn key nên không bị chọn lại, không audit trùng; lỗi một hồ sơ → rollback hồ sơ đó, các hồ sơ khác vẫn chạy, job throw để pg-boss thử lại. Dòng `platform.uploads` của ảnh không bị động tới (chỉ là metadata, thuộc platform).
- **Quán đối tác & nhân viên quán (billing, BE-S4-06):** `billing.partners` (tên, địa chỉ, `photo_url` https công khai, `tags text[]`, `active`) — không xoá quán, chỉ tắt `active`. Admin (`partner:manage`) `GET|POST /admin/partners`, `GET|PATCH /admin/partners/:id`, `GET|POST /admin/partners/:id/staff`, `PATCH /admin/partners/:id/staff/:staffId`; mọi thao tác ghi audit cùng `tx` (`partner.create`, `partner.update`, `partner.staff_create`, `partner.staff_update`; meta chỉ tên trường đổi, không có PIN). Người dùng app `GET /partners` (`requireUser`, chỉ quán `active`, sắp theo tên; chưa chặn theo trạng thái eKYC). Nhân viên quán `billing.partner_staff`: PIN 6 số chỉ lưu `scrypt(HMAC(pepper, pin), salt)` (pepper dẫn xuất HKDF từ `AUTH_SECRET`, miền `tamgiao:billing:partner-*`), `device_id` gắn khi admin tạo hoặc ở lần đăng nhập thành công đầu tiên; sai PIN/thiết bị 5 lần khoá 15 phút (đếm dưới `FOR UPDATE`, lần sai được commit dù trả lỗi). `POST /partner/auth/login {staffId, pin, deviceId}` → token partner `pt1.<payload>.<HMAC-SHA256>` (staffId, partnerId, `tokenVersion`, exp 8 giờ). Guard `createRequirePartnerStaff` (`presentation/partner-auth-middleware.ts`, env `PartnerEnv` → `c.get('partnerStaff')`) kiểm chữ ký + hạn rồi **đọc lại DB mỗi request**: `tokenVersion` khớp (đổi PIN/thiết bị/vô hiệu hoá tăng version → token cũ `PARTNER_TOKEN_INVALID` 401), quán và tài khoản còn `active` (không → `PARTNER_INACTIVE` 403). Route partner của task sau (`POST /partner/vouchers/redeem`, BE-S4-05) dùng lại guard này. Nếu sau này đặt hẹn cần module riêng, tách phần `partner` ra khỏi billing thành module `partner` (giữ bảng, đổi schema bằng migration mới).
- **Composition root:** mỗi module export `createXModule(deps)` trả về `{ routes, handlers, facade }`; `apps/api/src/main.ts` và `apps/worker/src/main.ts` nối thủ công (không dùng DI container).
- **Xác thực người dùng app:** access token JWT HS256 15 phút (claims `sub`=userId, `sid`=sessionId) + refresh token ngẫu nhiên 256-bit chỉ lưu SHA-256 (`identity.refresh_tokens`), xoay vòng mỗi lần dùng; token đã dùng bị dùng lại → thu hồi cả phiên (`identity.sessions`, một phiên = một thiết bị). Middleware `requireUser(authenticate)` nằm ở `@tamgiao/http`, nhận hàm `identity.facade.authenticateUser` (kiểm tra chữ ký, hạn **và** phiên chưa thu hồi) và gắn `c.get('auth') = { userId, sessionId }`; module khác dùng lại middleware này, không tự đọc token.
- **Xác thực admin:** email + mật khẩu argon2id + TOTP (RFC 6238, secret mã hoá `totp_secret_enc`, chặn dùng lại mã) — thiếu một trong hai không đăng nhập được; sai 5 lần khoá 15 phút. Token phiên dạng opaque (DB chỉ lưu SHA-256, `identity.admin_sessions`), 8 giờ / 12 giờ nếu "ghi nhớ thiết bị". Bảng role → permission ở `identity/domain/permissions.ts` (tên permission xuất lại ở `@tamgiao/contracts`). Route admin của mọi module gắn guard `identity.requireAdmin('<permission>')` (do composition root truyền vào): 401 nếu chưa đăng nhập, 403 `FORBIDDEN` nếu role thiếu quyền; role đọc lại từ DB mỗi request. Seed admin đầu tiên: `pnpm --filter @tamgiao/tools seed:admin --email <email> --role ADMIN`.
- **Audit log:** module cần ghi vết nhận `identity.auditLogger` (kiểu `AuditLogger` từ `@tamgiao/module-identity/facade`) qua composition root và gọi `log(tx, {actor, action, targetType, targetId, ip, meta})` — truyền `tx` để bản ghi audit commit/rollback cùng thao tác. `action` dạng `<miền>.<hành động>` (vd `kyc.view_detail`); `meta` chỉ chứa JSON không nhạy cảm, khoá có tên gợi PII (`phone`, `cccd`, `income`, `email`, `message`…) bị từ chối `AUDIT_ENTRY_INVALID`. Bảng `identity.audit_logs` chỉ ghi thêm: trigger cấp câu lệnh chặn mọi UPDATE/DELETE (kể cả role owner mà app đang dùng) + REVOKE khỏi PUBLIC. Admin xem qua `GET /admin/audit-logs` (permission `audit:read`, lọc actor/target/thời gian, phân trang cursor).
- **Lỗi HTTP:** Problem JSON (RFC 7807) `{ type, title, status, code, detail, traceId }`; map `code` → status tại presentation.

## 7. Kiểm thử

| Lớp | Loại | Công cụ |
|---|---|---|
| domain | unit, không mock | Vitest |
| application | use case + in-memory repo + FakeClock | Vitest |
| infrastructure | Postgres thật, test đồng thời | Vitest + Testcontainers |
| presentation | HTTP → DB | Vitest + `app.request()` của Hono |

## 8. Stack

pnpm workspaces + Turborepo · TypeScript strict · Hono · Drizzle + PostgreSQL 16 · pg-boss · Redis (S6) ·
Zod (contracts) · Vitest + Testcontainers · pino (redact PII) · Docker Compose (local) · GitHub Actions (CI).
