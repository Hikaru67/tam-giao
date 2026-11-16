# Sprint 1 — Nền móng

**Mục tiêu sprint:** Monorepo chạy được, CI xanh, API trả `/health`, có sẵn kernel (Result, Clock, Money, AggregateRoot),
UnitOfWork + outbox + job queue chạy end-to-end, hạ tầng test tích hợp với Postgres thật.

**Demo cuối sprint:** `docker compose up` → `pnpm dev` → `GET /health` 200; một event mẫu ghi vào outbox được worker relay
và handler xử lý đúng 1 lần (kể cả khi chạy lại).

**Nhóm chạy song song:** (01) → (02, 03, 07) → (04, 06, 09) → (05, 08)

---

### BE-S1-01 · Khởi tạo monorepo pnpm + Turborepo

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| repo | devops | P0 | 1d | — | — | IN_REVIEW |

**Mục tiêu:** Tạo khung repo để mọi task sau có chỗ đặt code và lệnh kiểm chứng chung.

**Phạm vi**
- Trong: `git init`, pnpm workspaces (`apps/*`, `packages/*`, `packages/modules/*`), Turborepo, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), ESLint (typescript-eslint, import rules cấm default export và cấm import chéo lớp theo A1/A3), Prettier, Vitest workspace, `.gitignore`, `.editorconfig`, `.nvmrc` (Node 22). Script root: `typecheck`, `lint`, `test`, `test:int`, `dev`, `build`, `db:generate`, `db:migrate`.
- Ngoài: Docker, CI (BE-S1-02, BE-S1-08), code nghiệp vụ.

**Tiêu chí nghiệm thu**
- [ ] AC1: `pnpm install && pnpm typecheck && pnpm lint && pnpm test` chạy thành công trên repo rỗng (có 1 package mẫu).
- [ ] AC2: ESLint báo lỗi khi file trong `domain/` import `drizzle-orm` hoặc `hono` (rule `no-restricted-imports` theo pattern thư mục).
- [ ] AC3: ESLint báo lỗi khi module A import `packages/modules/B/domain|infrastructure`.
- [ ] AC4: Di chuyển `design/` ← thư mục `stitch_verified_matchmaking_platform` (giữ bản `_original` ngoài repo hoặc trong `design/_original`).

**Test bắt buộc:** Fixture lint: 2 file vi phạm A1/A3 trong `tools/lint-fixtures` và test khẳng định ESLint báo lỗi.

**File dự kiến:** root config files, `packages/kernel/package.json` (placeholder), `tools/`, `design/`.

**Contract / Event:** Không có.

**Ghi chú:** Alias import: `@tamgiao/kernel`, `@tamgiao/contracts`, `@tamgiao/db`, `@tamgiao/testing`, `@tamgiao/module-<name>`.

---

### BE-S1-02 · Docker Compose local + cấu hình môi trường

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| repo | devops | P0 | 1d | BE-S1-01 | BE-S1-03, BE-S1-07 | IN_REVIEW |

**Mục tiêu:** Dev chạy toàn bộ hạ tầng phụ thuộc bằng 1 lệnh.

**Phạm vi**
- Trong: `docker-compose.yml` với Postgres 16, MinIO (tạo sẵn bucket `public-profile`, `private-kyc`); `.env.example`; `apps/api/src/config.ts` và `apps/worker/src/config.ts` parse env bằng Zod (fail-fast khi thiếu biến).
- Ngoài: Redis (thêm ở BE-S6-02), deploy.

**Tiêu chí nghiệm thu**
- [ ] AC1: `docker compose up -d` → Postgres và MinIO healthy; 2 bucket tồn tại.
- [ ] AC2: Thiếu biến bắt buộc → app thoát với thông báo liệt kê biến thiếu (không lộ giá trị secret).

**Test bắt buộc:** Unit test `config.ts`: env hợp lệ / thiếu biến / sai kiểu.

**File dự kiến:** `docker-compose.yml`, `.env.example`, `apps/api/src/config.ts`, `apps/worker/src/config.ts`, `apps/*/package.json`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### BE-S1-03 · Xây `packages/kernel`

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| kernel | domain | P0 | 2d | BE-S1-01 | BE-S1-02, BE-S1-07 | IN_REVIEW |

**Mục tiêu:** Cung cấp building block cho mọi module theo Clean Architecture.

**Phạm vi**
- Trong: `Result<T,E>` (ok/err, map, andThen, match), `Id` (UUID v7, branded type), `Entity`, `AggregateRoot` (`record()`, `pullEvents()`, `version`), `DomainEvent` (eventId, occurredAt, aggregateId, version, type), `Clock` port + `SystemClock` + `FakeClock` (set/advance), `Money` (VND, số nguyên, cộng/trừ/so sánh, cấm âm khi cần), `UnitOfWork` port + type `Tx` trừu tượng, `DomainError` base type.
- Ngoài: Hiện thực DB của UnitOfWork (BE-S1-04).

**Tiêu chí nghiệm thu**
- [ ] AC1: `kernel` không có dependency runtime ngoài thư viện UUID v7.
- [ ] AC2: `Money.of(299000).add(Money.of(1000))` = 300000; tạo Money từ số lẻ/âm (khi không cho phép) trả `err`.
- [ ] AC3: `AggregateRoot.pullEvents()` trả event theo thứ tự và xoá buffer.
- [ ] AC4: `FakeClock.advance({hours:24})` thay đổi `now()` đúng.

**Test bắt buộc:** Unit test 100% cho Result, Money, AggregateRoot, FakeClock.

**File dự kiến:** `packages/kernel/**`.

**Contract / Event:** Không có.

**Ghi chú:** Giữ API nhỏ; không thêm helper chưa có người dùng (A12).

---

### BE-S1-04 · `packages/db`: Drizzle, UnitOfWork, outbox

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| db | infrastructure | P0 | 2d | BE-S1-02, BE-S1-03 | BE-S1-06, BE-S1-09 | IN_REVIEW |

**Mục tiêu:** Chuẩn hoá cách truy cập DB, transaction và ghi domain event an toàn.

**Phạm vi**
- Trong: Drizzle client (node-postgres), `DrizzleUnitOfWork implements UnitOfWork`, type `DbTx`; schema `platform` gồm bảng `outbox(id, event_type, aggregate_id, payload jsonb, occurred_at, published_at)` và `processed_events(consumer, event_id, processed_at, PK(consumer,event_id))`; `OutboxWriter.append(tx, events[])`; cấu hình `drizzle-kit` đọc schema từ mọi module; script `db:generate`, `db:migrate`.
- Ngoài: Relay đọc outbox (BE-S1-05).

**Tiêu chí nghiệm thu**
- [ ] AC1: Lỗi bên trong `uow.run` → rollback toàn bộ (cả dữ liệu và outbox). Bao gồm cả 2 trường hợp: `work` **throw** và `work` **trả `Err`** (theo hợp đồng port `UnitOfWork` trong kernel) — trả lại đúng `Err` đó cho caller.
- [ ] AC2: `OutboxWriter.append` trong cùng `tx` với dữ liệu: commit thì cả hai tồn tại.
- [ ] AC3: Migration đầu tiên tạo schema `platform` chạy được trên DB trắng.

**Test bắt buộc:** Integration (Testcontainers): commit / rollback / nested call dùng lại `tx`.

**File dự kiến:** `packages/db/**`, `drizzle.config.ts`, `migrations/`.

**Contract / Event:** Migration `platform.outbox`, `platform.processed_events`.

**Ghi chú:** Phụ thuộc helper Testcontainers — nếu BE-S1-08 chưa xong, tạo helper tối thiểu trong `packages/testing` và ghi vào báo cáo.

---

### BE-S1-05 · Worker: outbox relay, EventBus, Scheduler (pg-boss)

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| db, worker | infrastructure | P0 | 2d | BE-S1-04 | BE-S1-08 | TODO |

**Mục tiêu:** Có cơ chế phát event tin cậy và hẹn giờ job (nền cho đếm ngược 24h/14 ngày).

**Phạm vi**
- Trong: pg-boss setup trong `apps/worker`; relay poll outbox (batch, `FOR UPDATE SKIP LOCKED`), đẩy vào `EventBus` nội bộ, đánh dấu `published_at`; API đăng ký handler `bus.on(eventType, consumerName, handler)`; wrapper idempotent dùng `processed_events`; port `Scheduler` (kernel hoặc db) + `PgBossScheduler.schedule(tx, jobKey, runAt, payload)` với job key chống trùng; retry + backoff, dead-letter log.
- Ngoài: Handler nghiệp vụ cụ thể.

**Tiêu chí nghiệm thu**
- [ ] AC1: Event trong outbox được handler nhận đúng 1 lần dù relay chạy 2 lần / 2 instance.
- [ ] AC2: Handler throw → retry theo backoff, sau N lần vào dead-letter, không chặn event khác.
- [ ] AC3: `schedule` cùng job key 2 lần chỉ tạo 1 job; job chạy đúng thời điểm (test với thời gian rút ngắn).

**Test bắt buộc:** Integration: idempotency 2 relay song song; retry; job key trùng.

**File dự kiến:** `apps/worker/src/**`, `packages/db/src/outbox/**`, `packages/db/src/scheduler/**`, `packages/kernel/src/scheduler.ts` (port).

**Contract / Event:** Không có event nghiệp vụ.

**Ghi chú:** —

---

### BE-S1-06 · Khung API Hono + xử lý lỗi + logger

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| api | presentation | P0 | 1.5d | BE-S1-02, BE-S1-03 | BE-S1-04, BE-S1-09 | TODO |

**Mục tiêu:** Khung HTTP thống nhất để mọi module đăng ký route giống nhau.

**Phạm vi**
- Trong: Hono app; composition root `main.ts` + `modules.ts` (pattern `createXModule(deps) → { routes, handlers, facade }`); middleware request-id/trace-id, CORS, body limit; logger pino với redact (phone, cccd, token, authorization, body chat); map lỗi → Problem JSON (RFC 7807) theo bảng `code → status`; `GET /health`, `GET /ready` (kiểm tra DB); graceful shutdown.
- Ngoài: Auth (BE-S2-02).

**Tiêu chí nghiệm thu**
- [ ] AC1: Use case trả `err('X_CODE')` → HTTP đúng status theo bảng map, body Problem JSON có `code`, `traceId`.
- [ ] AC2: Exception không bắt → 500, log có stack, response không lộ stack.
- [ ] AC3: Log không chứa giá trị trường bị redact (test snapshot log).

**Test bắt buộc:** Test `app.request()` cho health, lỗi nghiệp vụ, lỗi 500, redact.

**File dự kiến:** `apps/api/src/**`.

**Contract / Event:** Schema Problem JSON trong `packages/contracts/src/http.ts`.

**Ghi chú:** —

---

### BE-S1-07 · `packages/contracts`: hằng số, mã lỗi, envelope

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| contracts | presentation | P0 | 1d | BE-S1-01 | BE-S1-02, BE-S1-03 | IN_REVIEW |

**Mục tiêu:** Một nguồn chân lý cho hằng số nghiệp vụ và hợp đồng API giữa BE và FE.

**Phạm vi**
- Trong: `constants.ts` (toàn bộ bảng AGENTS.md mục 6), `errors.ts` (registry mã lỗi + status mặc định), `http.ts` (Problem JSON, phân trang cursor), cấu trúc thư mục DTO theo module, cấu hình sinh OpenAPI từ Zod (`@hono/zod-openapi` hoặc tương đương).
- Ngoài: DTO cụ thể của từng module (thêm trong task module).

**Tiêu chí nghiệm thu**
- [ ] AC1: Hằng số khớp bảng AGENTS.md mục 6 (test so sánh).
- [ ] AC2: Đăng ký trùng mã lỗi → lỗi lúc build/test.

**Test bắt buộc:** Unit test registry lỗi và hằng số.

**File dự kiến:** `packages/contracts/**`.

**Contract / Event:** Khởi tạo registry.

**Ghi chú:** Package này được FE dùng → không import gì từ backend.

---

### BE-S1-08 · Hạ tầng test tích hợp + CI

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| testing, repo | devops | P0 | 1.5d | BE-S1-04 | BE-S1-05 | TODO |

**Mục tiêu:** Mọi task có infrastructure đều chạy test với Postgres thật, CI tự động chặn PR lỗi.

**Phạm vi**
- Trong: `packages/testing`: khởi tạo Postgres Testcontainers 1 lần/worker, chạy migration, reset dữ liệu giữa test (truncate theo schema), helper `withTx`, helper chạy đồng thời `runConcurrently(n, fn)`; GitHub Actions: install (cache pnpm), typecheck, lint, test, test:int; badge trạng thái.
- Ngoài: Deploy (BE-S7-08).

**Tiêu chí nghiệm thu**
- [ ] AC1: `pnpm test:int` chạy được local và trên CI.
- [ ] AC2: PR có test fail → CI đỏ.
- [ ] AC3: Thời gian `test:int` cho repo hiện tại < 2 phút trên CI.

**Test bắt buộc:** Test mẫu dùng helper reset + `runConcurrently`.

**File dự kiến:** `packages/testing/**`, `.github/workflows/ci.yml`, `vitest.workspace.ts`.

**Contract / Event:** Không có.

**Ghi chú:** —

---

### BE-S1-09 · Port `Encryptor` + mã hoá envelope + blind index

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| kernel, db | infrastructure | P0 | 1.5d | BE-S1-03 | BE-S1-04, BE-S1-06 | TODO |

**Mục tiêu:** Chuẩn bị mã hoá trường nhạy cảm (CCCD, thu nhập, tài sản) trước khi các module dùng.

**Phạm vi**
- Trong: Port `Encryptor { encrypt(plain, context): Bytes; decrypt(bytes, context): string }` và `BlindIndexer { index(value, purpose): string }`; `LocalKeyEncryptor` (AES-256-GCM, data key ngẫu nhiên mỗi bản ghi, data key mã hoá bằng master key từ env, có `keyVersion` để xoay khoá); HMAC-SHA256 blind index (khoá riêng theo purpose); chuẩn hoá đầu vào (vd CCCD bỏ khoảng trắng).
- Ngoài: Adapter KMS cloud (chờ D5).

**Tiêu chí nghiệm thu**
- [ ] AC1: encrypt → decrypt trả lại giá trị gốc; sửa 1 byte ciphertext → decrypt lỗi.
- [ ] AC2: Cùng plaintext mã hoá 2 lần cho ciphertext khác nhau; blind index giống nhau.
- [ ] AC3: Đổi master key (version mới) vẫn decrypt được dữ liệu cũ.

**Test bắt buộc:** Unit test 3 AC + test context sai → lỗi.

**File dự kiến:** `packages/kernel/src/crypto.ts` (port), `packages/db/src/crypto/**` (adapter).

**Contract / Event:** Không có.

**Ghi chú:** Liên quan D5.
