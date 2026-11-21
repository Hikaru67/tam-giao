# AGENTS.md — Rule chung cho mọi agent / subagent trong dự án Tâm Giao

> File này là **luật bắt buộc**. Mọi agent (kể cả subagent được giao 1 task) phải đọc hết file này
> trước khi làm việc và tuân thủ đúng format ở mục 9 (báo cáo). Nếu rule mâu thuẫn với yêu cầu
> trong task → dừng lại, báo trong mục "Blocker/Câu hỏi", không tự chọn.

Tài liệu liên quan (đọc theo thứ tự):
1. `AGENTS.md` (file này)
2. `docs/ARCHITECTURE.md` — kiến trúc Clean Architecture + modular monolith
3. `docs/backlog/README.md` — tổng quan sprint, quyết định còn mở
4. Block task được giao trong `docs/backlog/sprint-XX.md`
5. Code hiện có của module liên quan

---

## 1. Nguyên tắc làm việc

1. **Một agent = một task.** Chỉ làm đúng phạm vi "Trong" của task. Việc ngoài phạm vi → ghi vào
   "Việc phát sinh đề xuất", không tự làm.
2. **Không tự bịa luật nghiệp vụ.** Mọi con số / luật nghiệp vụ lấy từ `packages/contracts/src/constants.ts`
   (xem mục 6) hoặc từ task. Thiếu thông tin → dùng giá trị trong task, nếu task cũng không có → BLOCKED.
3. **Kiểm tra phụ thuộc trước khi code.** Task trong "Phụ thuộc" phải ở trạng thái `DONE`. Nếu chưa → BLOCKED.
4. **Quyết định còn mở (D1…D6 trong backlog README)** không được chặn task: luôn code qua **port + Fake adapter**;
   adapter thật chỉ viết khi task ghi rõ provider.
5. **Thứ tự triển khai trong một task:** `domain` → `application` (port + use case) → `infrastructure`
   (adapter, repository, migration) → `presentation` (route, DTO) → test tích hợp → cập nhật tài liệu.
6. **Kiểm chứng trước khi báo DONE** (mục 8). Không chạy được thì không được ghi DONE.
7. **Không sửa file ngoài vùng sở hữu** (mục 7) trừ khi task liệt kê rõ.
8. **Ngôn ngữ:** tài liệu, báo cáo, comment giải thích nghiệp vụ → tiếng Việt. Code, tên biến, tên file,
   tên test, commit message → tiếng Anh.

## 2. Luật kiến trúc (bắt buộc)

Chi tiết: `docs/ARCHITECTURE.md`. Tóm tắt luật không được vi phạm:

| # | Luật |
|---|---|
| A1 | **Dependency rule:** `domain` chỉ import `@tamgiao/kernel` và `@tamgiao/contracts/constants` (hằng số thuần, không Zod). `application` import thêm `domain` và `@tamgiao/module-<khác>/facade`. `presentation` chỉ import `application` (không import `infrastructure`). `infrastructure`/`presentation` mới được import framework (Hono, Drizzle, pg-boss, SDK bên thứ ba). Luật này được ESLint ép tự động bằng rule `tamgiao/architecture-boundaries` (`tools/eslint-plugin`). |
| A2 | **Không dùng Zod trong domain/application.** Zod chỉ ở `packages/contracts` và `presentation`. Domain dùng Value Object. |
| A3 | **Ranh giới module:** module A **không** import `domain`/`infrastructure` của module B, **không** đọc bảng của module B. Giao tiếp qua (a) domain event qua outbox, hoặc (b) facade read-only export từ `modules/<b>/application/facade.ts`. |
| A4 | **Lỗi nghiệp vụ trả `Result<T, E>`**, không `throw`. `throw` chỉ cho lỗi lập trình / hạ tầng. Mã lỗi là string `UPPER_SNAKE_CASE`, khai báo trong `domain/errors.ts` của module và đăng ký ở `packages/contracts/src/errors.ts`. |
| A5 | **Transaction qua `UnitOfWork.run(tx => …)`.** Repository nhận `tx` làm tham số, không tự mở connection/transaction. |
| A6 | **Domain event chỉ phát qua outbox**: aggregate `record()` event → repository `save()` ghi outbox trong cùng `tx`. Không publish trực tiếp từ use case. |
| A7 | **Thời gian lấy từ port `Clock`**, không gọi `new Date()`/`Date.now()` trong domain/application. |
| A8 | **Tiền dùng `Money` (số nguyên VND, `bigint` trong DB)**, không dùng float. |
| A9 | **Mọi job/consumer phải idempotent**: chạy lại không đổi kết quả (kiểm tra lại state + `processed_events`). |
| A10 | **Luật xuyên aggregate (độc quyền 1-1, CCCD trùng, voucher dùng 1 lần) phải có ràng buộc DB** (unique/constraint/`SELECT … FOR UPDATE`) + test đồng thời. Không chỉ check ở code. |
| A11 | **Module "mỏng"** (`profile`, `notification`) được phép controller → repository trực tiếp, không bắt buộc đủ 4 lớp. Các module còn lại phải đủ lớp. |
| A12 | **Không tạo interface cho thứ chỉ có 1 hiện thực và không cần fake khi test.** |

## 3. Quy ước code

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. Cấm `any` (dùng `unknown` + thu hẹp kiểu). Cấm `// @ts-ignore`; `@ts-expect-error` phải có lý do.
- ESM, **named export** (cấm default export, trừ file config công cụ yêu cầu).
- Tên file `kebab-case.ts`. Class/Type `PascalCase`. Hàm/biến `camelCase`. Hằng số `UPPER_SNAKE_CASE`.
- Use case: class `VerbNoun` (vd `AcceptOffer`), một method `execute(cmd)`; file `accept-offer.ts`.
- Port: `XxxRepository`, `XxxGateway`, `XxxSender`… (interface). Adapter: `<Tech><Port>` (vd `DrizzleMatchRepository`, `FakeEkycProvider`, `PayosPaymentGateway`).
- Domain event: thì quá khứ, `PascalCase` (vd `MatchOffered`), có `eventId`, `occurredAt`, `aggregateId`, `version`.
- Id: UUID v7 qua `Id` của kernel. Thời gian: UTC, `timestamptz`.
- Không để logic nghiệp vụ trong controller/route. Controller chỉ: parse DTO → gọi use case → map kết quả.

## 4. Database & migration

- Drizzle ORM + `drizzle-kit`. **Mỗi module một Postgres schema** (vd `matching.matches`, `billing.ledger_entries`).
- Migration tạo bằng `pnpm db:generate`, review SQL trước khi commit. **Không sửa migration đã merge**, chỉ thêm migration mới.
- Cột mã hoá có hậu tố `_enc` (bytea), cột blind index hậu tố `_bidx`.
- Tiền: `bigint` (VND). Trạng thái: `text` + `CHECK` hoặc enum Postgres.
- Bảng log (`ledger_entries`, `audit_logs`, `match_events`) **chỉ ghi thêm** — không UPDATE/DELETE.

## 5. Bảo mật & dữ liệu cá nhân (Nghị định 13/2023)

- **Không log PII** (SĐT, CCCD, thu nhập, ảnh, nội dung chat). Logger đã cấu hình redact; không lách bằng `console.log`.
- Dữ liệu nhạy cảm (số CCCD, thu nhập, tài sản, giấy độc thân) **mã hoá qua port `Encryptor`** ở tầng infrastructure. Domain chỉ thấy Value Object.
- Ảnh CCCD/selfie/bằng chứng nằm ở **bucket private**, truy cập bằng presigned URL hết hạn ≤ 5 phút.
- Mọi lần admin **đọc** dữ liệu nhạy cảm phải ghi `audit_logs` qua `AuditLogger`.
- Không commit secret. Biến môi trường khai báo trong `apps/*/src/config.ts` (Zod) + `.env.example`.
- Endpoint nhận webhook phải **verify chữ ký** và **idempotent**.

## 6. Hằng số nghiệp vụ (nguồn chân lý)

Khai báo tại `packages/contracts/src/constants.ts`. Không hardcode ở chỗ khác.

| Hằng số | Giá trị | Ghi chú |
|---|---|---|
| `OFFER_TTL_HOURS` | 24 | Thời gian suy nghĩ gợi ý (OFFERED) |
| `RESPONSE_TTL_HOURS` | 24 | Chờ đối phương phản hồi (AWAITING_RESPONSE) |
| `DATING_DAYS` | 14 | Giai đoạn tìm hiểu độc quyền |
| `COOLDOWN_DAYS` | 7 | Nghỉ sau khi dừng tìm hiểu |
| `DEPOSIT_VND` | 299_000 | Khoản thu khi xác thực (tên gọi chờ D1) |
| `VOUCHER_VND` | 300_000 | Voucher hẹn hò tặng kèm |
| `VOUCHER_TTL_DAYS` | 90 | Hạn voucher kể từ khi hồ sơ được duyệt |
| `REFUND_SLA_HOURS` | 48 | Hoàn tiền khi hồ sơ không được duyệt |
| `OTP_TTL_SECONDS` | 120 | |
| `OTP_MAX_ATTEMPTS` | 5 | |
| `PRESIGNED_URL_TTL_SECONDS` | 300 | |
| `MAX_PROFILE_PHOTOS` | 5 | |
| `SAFETY_RESPONSE_SLA_MINUTES` | 30 | Chuyên viên phản hồi báo cáo khẩn cấp |
| `MIN_AGE` | 20 | **Chờ xác nhận (D6)** |
| `KYC_MEDIA_RETENTION_DAYS` | 30 | **Chờ xác nhận (D6)** |
| `INTERVIEW_DURATION_MINUTES` | 15 | Thời lượng slot phỏng vấn sơ bộ (BE-S3-05) |
| `INTERVIEW_CHANGE_CUTOFF_HOURS` | 2 | Huỷ/đổi lịch phỏng vấn trước giờ bắt đầu ít nhất (BE-S3-05) |
| `MESSAGE_MAX_LENGTH` | 2_000 | Độ dài tối đa một tin chat, ký tự (BE-S6-01) |
| `MESSAGE_RATE_LIMIT_PER_MINUTE` | 30 | Số tin tối đa / người / hội thoại trong 60 giây (BE-S6-01) |

## 7. Vùng sở hữu file (tránh xung đột khi nhiều subagent chạy song song)

- Task của module X chỉ sửa: `packages/modules/X/**`, migration của schema X, route đăng ký X trong `apps/api/src/modules.ts`.
- Sửa `packages/kernel`, `packages/contracts`, `packages/db`, `apps/*/src/main.ts`, CI, config gốc → **chỉ khi task liệt kê rõ** trong "File dự kiến". Nếu cần mà task không cho phép → ghi vào "Việc phát sinh đề xuất".
- Thêm mã lỗi / DTO / event mới vào `packages/contracts` là **được phép** (chỉ thêm, không sửa/xoá cái cũ).

## 8. Kiểm chứng & Definition of Done

Lệnh bắt buộc chạy trước khi báo DONE (ở root):

```bash
pnpm typecheck
pnpm lint
pnpm test          # unit (domain + application)
pnpm test:int      # integration (Testcontainers Postgres) — nếu task có infrastructure
```

Task chỉ `DONE` khi **tất cả** đúng:

- [ ] Mọi tiêu chí nghiệm thu (AC) đạt, mỗi AC có ít nhất 1 test chứng minh.
- [ ] Domain: test mọi nhánh luật / chuyển trạng thái hợp lệ và không hợp lệ.
- [ ] Use case: test với repository in-memory + `FakeClock`.
- [ ] Repository/constraint: test tích hợp với Postgres thật; luật xuyên aggregate có test đồng thời.
- [ ] 4 lệnh ở trên pass; báo đúng số test pass/fail.
- [ ] Không vi phạm luật A1–A12, mục 5.
- [ ] Contract/event/migration mới đã ghi trong báo cáo; `docs/ARCHITECTURE.md` cập nhật nếu đổi thiết kế.
- [ ] Cập nhật `Trạng thái` của task trong file sprint.

## 9. Format báo cáo (bắt buộc, đúng thứ tự heading)

Mọi agent kết thúc task bằng đúng block sau (không thêm/bớt heading):

```markdown
## Báo cáo task <TASK-ID> — <Tiêu đề>

**Trạng thái:** DONE | PARTIAL | BLOCKED

### Tóm tắt
<1–3 câu: đã làm gì, kết quả chính>

### Thay đổi
| File | Loại | Mô tả |
|---|---|---|
| packages/modules/matching/domain/match.ts | thêm | Aggregate Match + luật chuyển trạng thái |

### Tiêu chí nghiệm thu
| AC | Kết quả | Test chứng minh |
|---|---|---|
| AC1 | ✅ | `match.test.ts > rejects accept after expiry` |

### Kiểm chứng
| Lệnh | Kết quả |
|---|---|
| pnpm typecheck | pass |
| pnpm lint | pass |
| pnpm test | 42 pass / 0 fail |
| pnpm test:int | 8 pass / 0 fail (hoặc "không áp dụng") |

### Contract / Event / Migration
- <DTO, mã lỗi, event, migration mới hoặc "Không có">

### Quyết định tự đưa ra
- <Lựa chọn kỹ thuật không có trong task + lý do, hoặc "Không có">

### Blocker / Câu hỏi
- <hoặc "Không có">

### Việc phát sinh đề xuất (chưa làm)
- <hoặc "Không có">
```

Quy ước trạng thái task: `TODO` → `IN_PROGRESS` → `IN_REVIEW` → `DONE`; hoặc `BLOCKED` (ghi lý do).

## 10. Git

- **Nhánh sprint:** mỗi sprint một nhánh `sprint/<NN>` (vd `sprint/02`) tạo từ `main`.
- **Nhánh task:** `feat/<TASK-ID>-<mo-ta-ngan>` (vd `feat/BE-S5-01-match-aggregate`) tạo từ nhánh sprint.
  Task xong (đủ mục 8) → merge `--no-ff` vào nhánh sprint, commit merge `Merge <TASK-ID> into sprint/<NN>`;
  báo cáo mục 9 lưu ở nội dung commit merge hoặc trong báo cáo cho người giao task. Không mở PR cho từng task.
- **PR vào `main`:** chỉ mở **một PR `sprint/<NN>` → `main`** khi mọi task của sprint đã merge vào nhánh sprint;
  mô tả PR liệt kê các task kèm block báo cáo mục 9 của từng task. Không commit/push thẳng `main`.
- Commit: Conventional Commits + task ID: `feat(matching): add Match aggregate [BE-S5-01]`.
- **Không thêm dòng `Co-Authored-By` hay attribution Claude/AI** vào commit hoặc PR.
