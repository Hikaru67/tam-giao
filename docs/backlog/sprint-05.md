# Sprint 5 — Matching (lõi nghiệp vụ)

**Mục tiêu sprint:** Chuyên viên đề xuất 1 hồ sơ duy nhất cho mỗi người; người dùng xem gợi ý, đồng ý / bỏ qua;
cả hai đồng ý → DATING 14 ngày; hết 24h tự động hết hạn; bảo đảm **một người – một lúc** bằng ràng buộc DB; cooldown 7 ngày.

**Demo cuối sprint:** Màn 7 (gợi ý + đếm ngược) → màn 8 (chi tiết) → đồng ý → màn 9 (chờ phản hồi) → đối phương đồng ý → `MatchStartedDating`.
Thử đề xuất người đang bận → `USER_BUSY`. Tua thời gian 24h → `EXPIRED`.

**Nhóm chạy song song:** (01, 02, 03) → (04) → (05, 06) → (07)

---

### BE-S5-01 · Aggregate `Match` + máy trạng thái

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| matching | domain | P0 | 2d | Sprint 1 | BE-S5-02, BE-S5-03 | DONE |

**Mục tiêu:** Mã hoá toàn bộ luật vòng đời ghép đôi (ARCHITECTURE mục 5) vào domain, test được không cần DB.

**Phạm vi**
- Trong: `Match` với trạng thái `OFFERED, AWAITING_RESPONSE, DATING, MET, CLOSED_SUCCESS, CLOSED_STOPPED, EXPIRED, DECLINED, LOCKED`; method `accept(by, now)`, `decline(by, reason, now)`, `withdraw(by, now)`, `expire(now)`, `markMet(now)`, `close(outcome, now)`, `lock(reason, now)`; `expiresAt` theo `OFFER_TTL_HOURS` / `RESPONSE_TTL_HOURS` / `DATING_DAYS`; `isOpen()`; event `MatchOffered`, `MatchAwaitingResponse`, `MatchStartedDating`, `MatchDeclined`, `MatchExpired`, `MatchClosed{outcome}`, `MatchLocked`; mã lỗi.
- Ngoài: Persistence, độc quyền xuyên aggregate (BE-S5-02).

**Tiêu chí nghiệm thu**
- [ ] AC1: Mọi cặp (trạng thái × hành động) có test: hợp lệ → state + event đúng; không hợp lệ → `INVALID_TRANSITION`.
- [ ] AC2: `accept` sau `expiresAt` → `OFFER_EXPIRED`; `expire()` trước `expiresAt` → `NOT_YET_EXPIRED`.
- [ ] AC3: Người ngoài cặp thao tác → `NOT_PARTICIPANT`.
- [ ] AC4: `expire()` gọi lại trên match đã đóng → no-op không lỗi (phục vụ idempotent job).

**Test bắt buộc:** Unit dạng bảng (table-driven) phủ 100% chuyển trạng thái.

**File dự kiến:** `packages/modules/matching/domain/**`, `packages/contracts/src/matching/events.ts`.

**Contract / Event:** Event matching; mã lỗi `INVALID_TRANSITION`, `OFFER_EXPIRED`, `NOT_PARTICIPANT`, `NOT_YET_EXPIRED`.

**Ghi chú:** Đây là task quan trọng nhất của dự án — review kỹ trước khi merge.

---

### BE-S5-02 · Độc quyền 1-1 (`active_slots`) + cooldown

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| matching | application, infrastructure | P0 | 1.5d | Sprint 1 | BE-S5-01, BE-S5-03 | DONE |

**Mục tiêu:** Bảo đảm bằng DB: một người chỉ ở trong tối đa 1 match đang mở; tôn trọng cooldown.

**Phạm vi**
- Trong: Port `ActiveSlotRepository { claim(tx, userIds[], matchId) → Result<void,'USER_BUSY'>; release(tx, matchId) }` + adapter (bảng `matching.active_slots(user_id PK, match_id)`, bắt lỗi unique → `USER_BUSY`); port `CooldownRepository { isCooling(tx, userId, now); start(tx, userId, until) }`; bảng `matching.pair_history(user_low, user_high, last_outcome)` để không đề xuất lại cặp đã từ chối/đóng.
- Ngoài: Use case (BE-S5-04).

**Tiêu chí nghiệm thu**
- [ ] AC1: 2 transaction đồng thời cùng claim 1 user → đúng 1 thành công, 1 `USER_BUSY` (chạy 50 lần không flaky).
- [ ] AC2: `release` xong → claim lại được.
- [ ] AC3: User đang cooldown → `isCooling=true` tới đúng `until`.

**Test bắt buộc:** Integration đồng thời với `runConcurrently`.

**File dự kiến:** `packages/modules/matching/application/ports/**`, `packages/modules/matching/infrastructure/**`.

**Contract / Event:** Migration `matching.active_slots`, `matching.cooldowns`, `matching.pair_history`; mã lỗi `USER_BUSY`, `USER_COOLING_DOWN`, `PAIR_ALREADY_TRIED`.

**Ghi chú:** A10.

---

### BE-S5-03 · Chấm điểm tương hợp + tìm ứng viên

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| matching | domain, application, infrastructure | P0 | 2d | BE-S2-06 | BE-S5-01, BE-S5-02 | DONE |

**Mục tiêu:** Tạo con số "94% tương hợp" và phân tích 3 trụ cột (màn 7) + danh sách top N cho chuyên viên.

**Phạm vi**
- Trong: Domain service `CompatibilityScorer` (input: hồ sơ + tiêu chí hai người dạng Value Object; output: tổng điểm 0–100, điểm 3 trụ cột "Giá trị sống & Gia đình", "Kế hoạch & Thời điểm kết hôn", "Lối sống & Tài chính", danh sách điểm chung) — trọng số đặt trong 1 file cấu hình domain; port `CandidateFinder.find(userId, limit)` lọc cứng **hai chiều** bằng SQL (tuổi, khu vực, con cái, tôn giáo, giới tính phù hợp), loại người bận / cooldown / đã thử / chưa xác thực (qua facade verification hoặc read model).
- Ngoài: ML/embedding.

**Tiêu chí nghiệm thu**
- [ ] AC1: Vi phạm bộ lọc cứng một chiều → ứng viên bị loại.
- [ ] AC2: Cùng input → cùng điểm (deterministic); điểm trụ cột và tổng nằm trong 0–100.
- [ ] AC3: Ứng viên đang bận / cooldown / chưa xác thực không xuất hiện.

**Test bắt buộc:** Unit scorer (bảng case); integration CandidateFinder với dữ liệu mẫu.

**File dự kiến:** `packages/modules/matching/**`.

**Contract / Event:** Không có.

**Ghi chú:** Cần read model hồ sơ trong matching (đồng bộ qua event `ProfileCompleted`, `PreferencesUpdated`, `KycApproved`) để không đọc bảng module khác (A3) — tạo bảng `matching.candidate_profiles` + handler.

---

### BE-S5-04 · Use case `ProposeMatch` (chuyên viên đề xuất)

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| matching | application, infrastructure | P0 | 1.5d | BE-S5-01, BE-S5-02, BE-S5-03, BE-S3-07 | — | DONE |

**Mục tiêu:** Phục vụ nút "Phê duyệt & Gửi đề xuất ghép đôi" (admin).

**Phạm vi**
- Trong: Kiểm tra cả hai đã xác thực, không cooldown, chưa từng thử cặp; tạo Match `OFFERED` (score snapshot, ghi chú chuyên viên, `created_by`); `claim` active slot cho cả hai trong cùng `tx`; `Scheduler.scheduleExpiry`; repository `DrizzleMatchRepository` (save + outbox + `match_events` append-only); permission `match:propose`; audit.
- Ngoài: Thông báo đẩy (S7).

**Tiêu chí nghiệm thu**
- [ ] AC1: Một trong hai đang bận → `USER_BUSY`, không tạo match, không lên lịch job.
- [ ] AC2: Thành công → match + 2 active slot + event `MatchOffered` + job hết hạn, tất cả cùng transaction.
- [ ] AC3: 2 chuyên viên đề xuất đồng thời cho cùng 1 user với 2 người khác nhau → chỉ 1 thành công.

**Test bắt buộc:** Use case in-memory; integration đồng thời.

**File dự kiến:** `packages/modules/matching/**`.

**Contract / Event:** Migration `matching.matches`, `matching.match_events`.

**Ghi chú:** —

---

### BE-S5-05 · Đồng ý / Bỏ qua / Rút lời ngỏ / Hết hạn

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| matching | application, infrastructure | P0 | 2d | BE-S5-04 | BE-S5-06 | TODO |

**Mục tiêu:** Phục vụ nút "Đồng ý kết nối" / "Bỏ qua" (màn 7–8), "Rút lại lời ngỏ" (màn 9), tự hết hạn 24h.

**Phạm vi**
- Trong: Use case `AcceptOffer`, `DeclineOffer`, `WithdrawIntro`, `ExpireMatch` (job, idempotent: tải lại match, nếu đã đóng hoặc chưa tới hạn → no-op); khi match đóng (`DECLINED`/`EXPIRED`) → `release` slot + ghi `pair_history`; khi vào `DATING` → lên lịch hết hạn 14 ngày; `CLOSED_STOPPED` → cooldown `COOLDOWN_DAYS`.
- Ngoài: Chuyển `MET`/`CLOSED_*` qua feedback (BE-S7-03).

**Tiêu chí nghiệm thu**
- [ ] AC1: A đồng ý → `AWAITING_RESPONSE` (hạn mới 24h); B đồng ý → `DATING` (hạn 14 ngày).
- [ ] AC2: Job hết hạn chạy 2 lần → 1 lần chuyển trạng thái, 1 bộ event.
- [ ] AC3: Bỏ qua → slot được giải phóng; cặp này không bao giờ được đề xuất lại.
- [ ] AC4: Đồng ý đúng lúc job hết hạn đang chạy → kết quả nhất quán (một trong hai thắng, không có trạng thái lai).

**Test bắt buộc:** Use case với FakeClock; integration race accept vs expire.

**File dự kiến:** `packages/modules/matching/**`, `apps/worker/src/**` (đăng ký job).

**Contract / Event:** Mã lỗi `OFFER_EXPIRED`, `ALREADY_RESPONDED`.

**Ghi chú:** Dùng `getForUpdate` để tuần tự hoá race.

---

### BE-S5-06 · Query cho màn hình user & admin

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| matching | application, infrastructure | P0 | 1.5d | BE-S5-04 | BE-S5-05 | IN_REVIEW |

**Mục tiêu:** Cung cấp dữ liệu cho màn 7, 8, 9 và admin (đề xuất mai mối, bảng theo dõi cặp).

**Phạm vi**
- Trong: `GetCurrentMatchForUser` (gợi ý hiện tại / đang chờ / đang hẹn, `expiresAt`, điểm 3 trụ cột, lời nhắn chuyên viên); `GetMatchProfile` (hồ sơ chi tiết đối phương — **chỉ người trong cặp**, phần riêng tư chỉ hiện khi đã qua bước đồng ý theo luật hiển thị); admin `ListCandidates(userId)` top N kèm điểm; admin `MatchesBoard` (lọc trạng thái, sắp hết hạn).
- Ngoài: Route (BE-S5-07).

**Tiêu chí nghiệm thu**
- [x] AC1: Người ngoài cặp gọi `GetMatchProfile` → `NOT_PARTICIPANT`.
- [x] AC2: Query trả `expiresAt` từ server để client đếm ngược.

**Test bắt buộc:** Integration query với dữ liệu mẫu.

**File dự kiến:** `packages/modules/matching/application/queries/**`, `packages/modules/matching/infrastructure/**`.

**Contract / Event:** DTO response trong contracts.

**Ghi chú:** Thông tin hồ sơ lấy từ read model `candidate_profiles` (BE-S5-03).

---

### BE-S5-07 · HTTP routes matching (user + admin)

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| matching | presentation | P0 | 1d | BE-S5-05, BE-S5-06 | — | TODO |

**Mục tiêu:** Mở API cho mobile và admin.

**Phạm vi**
- Trong: `GET /me/match`, `GET /me/match/profile`, `POST /me/match/accept`, `POST /me/match/decline`, `POST /me/match/withdraw`; admin `GET /admin/users/:id/candidates`, `POST /admin/matches`, `GET /admin/matches`; Zod DTO; map lỗi → HTTP; OpenAPI.
- Ngoài: —

**Tiêu chí nghiệm thu**
- [ ] AC1: Luồng end-to-end qua HTTP: propose → A accept → B accept → `DATING`.
- [ ] AC2: Tất cả mã lỗi matching có mapping status trong registry.

**Test bắt buộc:** HTTP e2e (app.request + Postgres thật).

**File dự kiến:** `packages/modules/matching/presentation/**`, `packages/contracts/src/matching/**`, `apps/api/src/modules.ts`.

**Contract / Event:** DTO matching.

**Ghi chú:** —
