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
