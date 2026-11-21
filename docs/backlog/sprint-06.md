# Sprint 6 — Messaging & Safety

**Mục tiêu sprint:** Kênh chat bảo mật chỉ mở trong giai đoạn DATING 14 ngày, realtime qua WebSocket, lọc dấu hiệu lừa đảo,
che SĐT/link; người dùng báo cáo vi phạm → khoá tương tác 2 chiều ngay lập tức, chuyên viên xử lý trên admin.

**Demo cuối sprint:** Hai user ở DATING chat realtime (màn 10–11); gửi "chuyển khoản cho mình nhé" → bị gắn cờ + cảnh báo;
báo cáo (màn 14) → match `LOCKED`, hội thoại đóng, admin thấy báo cáo trong hàng chờ.

**Nhóm chạy song song:** (01, 03, 05, 07) → (02, 06) → (04)

---

### BE-S6-01 · Domain hội thoại + mở/đóng theo match

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| messaging | domain, application, infrastructure | P0 | 1.5d | Sprint 5 | BE-S6-03, BE-S6-05 | TODO |

**Mục tiêu:** Chat chỉ tồn tại khi match đang DATING (nguyên tắc "một người thật, một lúc").

**Phạm vi**
- Trong: Aggregate `Conversation` (`OPEN`/`CLOSED`, participants, `openedAt`, `closesAt`); `Message` (sender, body, kind `TEXT|IMAGE|SYSTEM`, `flagged`, `maskedBody`); handler `MatchStartedDating` → mở hội thoại + tin hệ thống mở đầu; handler `MatchClosed`/`MatchLocked` → đóng; use case `SendMessage` (chỉ participant, chỉ khi OPEN, giới hạn độ dài, rate limit 30 tin/phút); repository.
- Ngoài: Transport realtime (BE-S6-02), lọc lừa đảo (BE-S6-03).

**Tiêu chí nghiệm thu**
- [ ] AC1: Gửi tin vào hội thoại CLOSED → `CONVERSATION_CLOSED`.
- [ ] AC2: Event `MatchStartedDating` xử lý 2 lần → chỉ 1 hội thoại.

**Test bắt buộc:** Unit domain; integration handler idempotent.

**File dự kiến:** `packages/modules/messaging/**`.

**Contract / Event:** Migration `messaging.conversations`, `messaging.messages`; event `MessageSent`, `MessageFlagged`; mã lỗi `CONVERSATION_CLOSED`, `NOT_PARTICIPANT`.

**Ghi chú:** Nội dung chat là PII — không log body.

---

### BE-S6-02 · WebSocket gateway + Redis pub/sub

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| messaging | presentation, infrastructure | P0 | 2.5d | BE-S6-01 | BE-S6-06 | TODO |

**Mục tiêu:** Tin nhắn realtime, chạy được nhiều instance API.

**Phạm vi**
- Trong: Thêm Redis vào docker-compose; WS endpoint `/ws` xác thực bằng access token (handshake); join room theo conversation (kiểm tra participant); sự kiện `message.send`, `message.new`, `message.read`, `typing`; phát qua Redis pub/sub cho đa instance; ack + idempotency key phía client (gửi lại không tạo tin trùng); heartbeat, reconnect + lấy tin bị lỡ qua `GET /me/conversations/:id/messages?after=`.
- Ngoài: Push khi offline (S7).

**Tiêu chí nghiệm thu**
- [ ] AC1: 2 client nối vào 2 instance khác nhau vẫn nhận tin của nhau.
- [ ] AC2: Gửi lại cùng idempotency key → 1 tin.
- [ ] AC3: Token hết hạn / không phải participant → bị ngắt kết nối với mã lỗi.

**Test bắt buộc:** Integration với 2 instance Hono + Redis Testcontainers.

**File dự kiến:** `packages/modules/messaging/presentation/**`, `packages/modules/messaging/infrastructure/**`, `docker-compose.yml`, `apps/api/src/main.ts` (gắn WS).

**Contract / Event:** Schema sự kiện WS trong `packages/contracts/src/messaging/ws.ts`.

**Ghi chú:** —

---

### BE-S6-03 · Bộ lọc lừa đảo + che SĐT/link

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| messaging | domain, application | P0 | 2d | Sprint 5 | BE-S6-01, BE-S6-05 | TODO |

**Mục tiêu:** Thực hiện cam kết "phát hiện & chặn lừa đảo tài chính" trên màn chat.

**Phạm vi**
- Trong: Domain service `FraudDetector` (luật regex/keyword có trọng số: chuyển khoản, STK, số tài khoản 9–16 số, ví điện tử, forex, crypto, đầu tư, vay, OTP, link rút gọn…; chuẩn hoá tiếng Việt bỏ dấu, chống lách bằng khoảng trắng/ký tự đặc biệt) trả `{ score, reasons }`; `ContactMasker` che SĐT, email, link, mạng xã hội trong `DATING_DAYS` đầu (có thể tắt khi cả hai đồng ý — ghi vào việc phát sinh); tích hợp vào `SendMessage`: vượt ngưỡng → `flagged`, gửi tin hệ thống cảnh báo cho người nhận, event `MessageFlagged` cho kiểm duyệt; luật cấu hình được trong file domain.
- Ngoài: ML phân loại.

**Tiêu chí nghiệm thu**
- [ ] AC1: Bộ ≥ 30 câu mẫu lừa đảo (có dấu, không dấu, viết lách) → phát hiện ≥ 90%; bộ ≥ 30 câu bình thường → báo nhầm ≤ 1.
- [ ] AC2: "0912 345 678", "zalo: 0912345678", "fb.com/abc" bị che trong body hiển thị.

**Test bắt buộc:** Unit dạng bảng với 2 bộ dữ liệu mẫu (lưu trong `__tests__/fixtures`).

**File dự kiến:** `packages/modules/messaging/domain/**`, `packages/modules/messaging/application/use-cases/send-message.ts`.

**Contract / Event:** Event `MessageFlagged`.

**Ghi chú:** —

---

### BE-S6-04 · Lịch sử tin nhắn + gợi ý phá băng

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| messaging | application, presentation | P1 | 1d | BE-S6-02 | — | TODO |

**Mục tiêu:** Phục vụ danh sách hộp thư (màn 10) và chip "Chủ đề sâu" (màn 11).

**Phạm vi**
- Trong: `GET /me/conversations` (tin cuối, số chưa đọc, tiến trình ngày X/14); `GET /me/conversations/:id/messages` (cursor, chỉ participant); `POST …/read`; gợi ý phá băng theo ngày tìm hiểu (danh sách cấu hình tĩnh).
- Ngoài: Tab chat với chuyên viên (ghi vào việc phát sinh nếu cần).

**Tiêu chí nghiệm thu**
- [ ] AC1: Phân trang ổn định khi có tin mới chen vào.
- [ ] AC2: Không phải participant → `NOT_PARTICIPANT`.

**Test bắt buộc:** HTTP + integration.

**File dự kiến:** `packages/modules/messaging/**`, `packages/contracts/src/messaging/**`.

**Contract / Event:** DTO conversation/message.

**Ghi chú:** —

---

### BE-S6-05 · Báo cáo vi phạm + khoá 2 chiều tức thì

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| safety | domain, application, infrastructure, presentation | P0 | 2d | Sprint 5 | BE-S6-01, BE-S6-03 | TODO |

**Mục tiêu:** Phục vụ màn "Báo cáo Vi phạm & Trung tâm An toàn Khẩn cấp".

**Phạm vi**
- Trong: Aggregate `Report` (category: `MARITAL_FRAUD`, `FINANCIAL_SCAM`, `HARASSMENT`, `NO_SHOW_DISRESPECT`; severity; mô tả ≤ 1000 ký tự; evidence keys từ bucket private; trạng thái `OPEN → IN_REVIEW → RESOLVED | DISMISSED`); `FileReport` → event `ReportFiled` → handler matching `LockMatch` (match `LOCKED`, release slot), handler messaging đóng hội thoại; tuỳ chọn "Chuyên viên can thiệp khẩn cấp" → đặt `dueAt = now + SAFETY_RESPONSE_SLA_MINUTES`; `POST /me/reports`.
- Ngoài: Màn admin xử lý (BE-S6-06).

**Tiêu chí nghiệm thu**
- [ ] AC1: Gửi báo cáo → trong cùng chu kỳ relay, match `LOCKED` và hội thoại `CLOSED`; người bị báo cáo không gửi được tin.
- [ ] AC2: Chỉ báo cáo được người đang/đã từng ghép với mình (`REPORT_TARGET_INVALID`).
- [ ] AC3: Evidence key phải thuộc người báo cáo.

**Test bắt buộc:** Unit domain; integration chuỗi event report → lock → close.

**File dự kiến:** `packages/modules/safety/**`, `packages/modules/matching/application/use-cases/lock-match.ts`, `packages/contracts/src/safety/**`.

**Contract / Event:** Migration `safety.reports`; event `ReportFiled`; mã lỗi `REPORT_TARGET_INVALID`.

**Ghi chú:** —

---

### BE-S6-06 · Admin kiểm duyệt: báo cáo, tin bị gắn cờ, khoá tài khoản

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| safety | application, infrastructure, presentation | P0 | 1.5d | BE-S6-05, BE-S6-03 | BE-S6-02 | TODO |

**Mục tiêu:** Phục vụ mục "Báo cáo Vi phạm & Khiếu nại" và thẻ "Cảnh báo vi phạm" trên admin.

**Phạm vi**
- Trong: Hàng chờ báo cáo (sắp xếp theo severity + `dueAt`, đánh dấu quá SLA); hàng chờ tin bị gắn cờ (đọc nội dung → audit); `ResolveReport` (ghi kết luận), `BanUser` (khoá vĩnh viễn: thu hồi phiên, ẩn khỏi ghép đôi, đóng mọi match mở; permission `safety:ban`, bắt buộc lý do, audit); event `UserBanned` → identity thu hồi token, matching loại khỏi candidate.
- Ngoài: Bàn giao cơ quan chức năng (quy trình ngoài hệ thống).

**Tiêu chí nghiệm thu**
- [ ] AC1: User bị ban → mọi token bị thu hồi, không còn trong `CandidateFinder`.
- [ ] AC2: Mỗi lần mở chi tiết báo cáo/tin gắn cờ có audit log.

**Test bắt buộc:** Integration chuỗi `UserBanned`; HTTP phân quyền.

**File dự kiến:** `packages/modules/safety/**`, handler trong `identity` và `matching` (chỉ file handler mới).

**Contract / Event:** Event `UserBanned`.

**Ghi chú:** —

---

### BE-S6-07 · Hồ sơ: tôn giáo & kế hoạch con cái của chính người dùng; lọc ứng viên hồ sơ ↔ tiêu chí

| Module | Lớp | Ưu tiên | Ước lượng | Phụ thuộc | Song song với | Trạng thái |
|---|---|---|---|---|---|---|
| profile, matching | domain, application, infrastructure, presentation | P1 | 1.5d | BE-S5-03 | BE-S6-01, BE-S6-03, BE-S6-05 | TODO |

**Mục tiêu:** Lọc cứng tôn giáo / con cái đúng nghĩa (người kia *là* gì so với điều mình *muốn*). Hiện hồ sơ chưa có hai
trường này nên BE-S5-03 so khớp đối xứng hai giá trị tiêu chí — PO đã chốt bổ sung trường vào hồ sơ (review BE-S5-03).

**Phạm vi**
- Trong: thêm `religion` (tôn giáo của bản thân) và `childrenPlan` (kế hoạch con cái của bản thân) vào hồ sơ — domain,
  `PUT /me/profile` DTO, migration `profile.profiles`, bắt buộc khi `submit: true` (hồ sơ cũ: cho phép null tới khi người
  dùng cập nhật — ghi quyết định); `ProfileFacade.getMatchingProfile` trả thêm hai trường; read model
  `matching.candidate_profiles` thêm cột tương ứng; `passesHardFilters` + `DrizzleCandidateFinder` đổi sang so **hồ sơ của
  người kia ↔ tiêu chí của mình** theo hai chiều (`not_important` ở tiêu chí = bỏ qua; con cái `open` — chốt lại với PO).
- Ngoài: đổi trọng số chấm điểm (giữ nguyên trừ khi PO yêu cầu).

**Tiêu chí nghiệm thu**
- [ ] AC1: A muốn bạn đời theo Phật giáo, B là Công giáo → B bị loại khỏi danh sách của A và A khỏi danh sách của B.
- [ ] AC2: Hồ sơ cũ chưa có hai trường → hành vi lọc được định nghĩa rõ (ghi trong ARCHITECTURE) và có test.

**Test bắt buộc:** Unit `passesHardFilters` dạng bảng; integration finder đối chiếu SQL ↔ domain trên lưới mẫu; HTTP profile.

**File dự kiến:** `packages/modules/profile/**`, `packages/modules/matching/**`, `packages/contracts/src/profile/**`, migration profile + matching.

**Contract / Event:** Migration thêm cột `profile.profiles` + `matching.candidate_profiles`; DTO profile.

**Ghi chú:** Phát sinh từ review BE-S5-03 (PO chọn "thêm trường vào hồ sơ").
