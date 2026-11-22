# Kiểm thử tải (BE-S7-09)

Kịch bản kiểm thử tải beta đánh giá khả năng chịu tải của hệ thống với 200 người dùng chat đồng thời kết hợp 50 req/s API chung, đồng thời giám sát độ trễ relay outbox và xử lý sự kiện bất đồng bộ qua consumer.

## Kịch bản

Thời lượng chạy: `LOAD_DURATION=3m`.

| Kịch bản | Cấu hình & Tải | Hành vi | Chỉ số đo | Ngưỡng đạt |
|---|---|---|---|---|
| **chat** | 200 VU (`per-vu-iterations`), 1 iteration/VU | Mỗi VU mở 1 WebSocket `/ws`, xác thực Bearer token, gửi `conversation.join`. Sau khi kết nối, gửi đều đặn 1 tin nhắn `message.send` mỗi `CHAT_INTERVAL_MS=4000` ms (lệch pha ngẫu nhiên). | `ws_ack_ms`: thời gian từ lúc gửi `message.send` đến khi nhận `message.ack`.<br>`ws_connect_ms`: thời gian nâng cấp và sẵn sàng socket.<br>`ws_errors`: số lỗi socket/protocol. | p95 `ws_ack_ms` < 300 ms<br>`ws_errors` = 0 (`count < 1`) |
| **api** | `constant-arrival-rate`, `API_RPS=50` req/s, preAllocatedVUs=50, maxVUs=300 | Giả lập người dùng duyệt các màn hình chính theo phân bổ trọng số:<br>- `GET /me` (25%)<br>- `GET /me/match` (20%)<br>- `GET /me/conversations` (20%)<br>- `GET /me/conversations/:id/messages?limit=20` (20%)<br>- `GET /me/vouchers` (10%)<br>- `GET /partners` (5%) | `http_req_duration{scenario:api}`<br>`http_req_failed{scenario:api}`<br>`checks` (HTTP 2xx) | p95 `http_req_duration` < 300 ms<br>Tỷ lệ lỗi < 1% (`rate < 0.01`)<br>`checks` rate > 99% |

### Relay outbox
Được đo độc lập bằng file SQL [outbox-latency.sql](outbox-latency.sql):
1. **Relay (`outbox.created_at → published_at`)**: thời gian worker quét outbox và chuyển thành job pg-boss. Ngưỡng: **p95 relay < 5 s**.
2. **Đầu-cuối (`outbox.created_at → processed_events.processed_at`)**: thời gian từ khi event phát sinh tới khi consumer xử lý xong hoàn toàn.

---

## Chạy

### Local

Sử dụng script [run-local.sh](../e2e/run-local.sh):

```bash
# 1. Khởi động hạ tầng container (Postgres, Redis, SeaweedFS) + migrate + seed admin + api/worker nền
tests/e2e/run-local.sh up

# 2. Seed dữ liệu: tạo LOAD_PAIRS=100 cặp DATING qua HTTP, ghi tests/e2e/.run/load-users.json
# Lưu ý: Token JWT chỉ sống 15 phút nên cần chạy lệnh load ngay sau khi seed xong
tests/e2e/run-local.sh seed

# 3. Chạy k6 tải + tự động đo outbox sau lượt chạy:
# Tự động dùng binary k6 nếu máy đã cài; nếu chưa có thì dùng Docker image grafana/k6:1.4.2 với K6_BASE_URL=http://host.docker.internal:3100
tests/e2e/run-local.sh load

# 4. Dừng api/worker và dọn sạch hạ tầng container
tests/e2e/run-local.sh down
```

### Staging

Chạy k6 từ máy điều phối kiểm thử:
```bash
K6_BASE_URL=<url> LOAD_USERS_FILE=<file> k6 run tests/load/chat-and-api.js
```

Đo độ trễ relay outbox trên cơ sở dữ liệu:
```bash
psql "$DATABASE_URL" -v since=<ISO> -f tests/load/outbox-latency.sql
```

---

## Rate limit (BE-S7-07)

- Trong [local.env](../e2e/local.env), `RATE_LIMIT_ENABLED=false` được cấu hình mặc định vì bước seed tải gửi hơn 1.000 request admin/phút từ một IP (duyệt 200 hồ sơ, ghép 100 cặp), vượt quá mức `RATE_LIMIT_GLOBAL_PER_MINUTE=600`. Nếu muốn đo tải kèm middleware rate limit, cần bật `RATE_LIMIT_ENABLED=true` đồng thời nâng các giá trị cấu hình `RATE_LIMIT_GLOBAL_PER_MINUTE`, `RATE_LIMIT_OTP_PER_MINUTE`, `RATE_LIMIT_LOGIN_PER_MINUTE`.
- Mỗi người dùng ảo khi gửi request đều kèm header `x-forwarded-for` riêng (`TRUST_PROXY=true` chỉ được cấu hình bật ở local).
- Trên staging, header `x-forwarded-for` giả lập **không có tác dụng** do reverse proxy phía trước luôn ghi IP client thật vào cuối chuỗi và ứng dụng căn cứ theo đó. Do đó, hạn mức OTP (5 lần/giờ/IP từ module `identity`) và rate limit sẽ chặn việc tạo hàng trăm tài khoản từ một IP nguồn. Cần tạm thời nới lỏng hạn mức trên môi trường kiểm thử hoặc thực hiện seed phân tán từ nhiều địa chỉ IP khác nhau.

---

## Kết quả

> [!NOTE]
> **SỐ ĐO LOCAL, KHÔNG PHẢI STAGING.**

**Cấu hình môi trường thử nghiệm:**
- Phần cứng: Apple M4 10 nhân, RAM 16 GB, Docker Desktop VM 10 CPU / 7,75 GiB.
- Dịch vụ phụ trợ: Postgres 16 / Redis 7.4 / SeaweedFS chạy trong Docker ([compose.yml](../e2e/compose.yml)).
- Ứng dụng: `api` + `worker` chạy trực tiếp trên host bằng Node 22.23.2 + `tsx` (1 instance mỗi loại).
- Công cụ tải: `grafana/k6:1.4.2` chạy trong Docker container.
- Tích hợp: Mọi provider bên thứ ba đều sử dụng Fake.

### Lượt 1 — 2026-11-22, trước bản sửa consumer (sprint/07 trước BE-S7-07)

| Hạng mục | Chỉ số đo | Kết quả | Trạng thái |
|---|---|---|---|
| **API chung** | Thời gian phản hồi `http_req_duration` | p95: **34,46 ms** (avg: 23,96 ms, med: 6,89 ms, p99: 307 ms, max: 2,61 s) | ĐẠT (< 300 ms) |
| | Lưu lượng & Tỷ lệ lỗi | 8 919 request, tốc độ thực tế **46,9 req/s** (82 iteration bị bỏ do thiếu VU), lỗi **0%** | ĐẠT (< 1%) |
| **Chat Realtime** | Thời gian phản hồi `ws_ack_ms` | p95: **39 ms** (avg: 22,13 ms, med: 6 ms, p99: 578 ms, max: 2,22 s) | ĐẠT (< 300 ms) |
| | Sản lượng gửi / nhận | 8 778 tin gửi / 8 778 ack / 8 778 tin nhận đối phương (tốc độ **46,2 tin/s**) | Hoàn tất |
| | Lỗi & Kết nối WS | `ws_errors`: **0**; kết nối socket p95: **271 ms** | ĐẠT (`ws_errors = 0`) |
| **Relay outbox** | Event `MessageSent` (8 778 event) | p50: **554 ms**, p95: **1 043 ms**, max: **3 534 ms** | ĐẠT (< 5 s) |
| **Đầu-cuối consumer** | Consumer `notification.on-message-sent` | Xử lý xong **94 event** trong 3 phút tải; p50: **91,9 s**, p95: **175 s**, max: **184 s** | **ĐIỂM NGHẼN** |

*Kết luận lượt 1:* Mọi ngưỡng HTTP và WebSocket k6 đều đạt xuất sắc; relay outbox đạt yêu cầu (< 5 s). Tuy nhiên, consumer thông báo tin nhắn bị dồn ứ nghiêm trọng ở tầng xử lý nền pg-boss.


### Lượt 2 — thử `burstWhenReadyExceeds: 1` (đã bỏ)

Bản sửa đầu tiên giữ `batchSize: 1` và bật `burstWhenReadyExceeds: 1`. Burst chỉ bật khi thống kê hàng đợi pg-boss
(`ready_count`, cache ~60 s) đã cập nhật → trễ tới hàng chục giây mới tăng tốc. Lượt đo (máy đang bận: OBS, Chrome, một
bộ Testcontainers khác; load average host vọt 47 cuối lượt): consumer xử lý đủ 8 799/8 799 event nhưng p95 đầu-cuối
**38,5 s**; API p95 1,26 s, ack p95 4,14 s (nhiễu do máy). Bị thay bằng bản sửa ở lượt 3.

### Lượt 3 — 2026-11-22, bản sửa cuối (lô 20 + `burstWhenBatchFull` + `perJobResults`) — **kết quả chính thức**

Code `sprint/07` sau BE-S7-07 (`RATE_LIMIT_ENABLED=false` trong `local.env`); load average host ~5,4 suốt lượt.
E2E toàn luồng ngay trước đó: **18/18 bước PASS** (31,6 s). Seed 100 cặp DATING: **34 s** (lượt 1: 403 s).

| Hạng mục | Chỉ số đo | Kết quả | Trạng thái |
|---|---|---|---|
| **API chung** | `http_req_duration` | p95 **16,78 ms** (avg 8,61, med 6,72, p99 41,82 ms, max 286 ms) | ĐẠT (< 300 ms) |
| | Lưu lượng & lỗi | 9 001 request, 47,4 req/s thực tế (0 iteration bị bỏ), lỗi **0%** | ĐẠT |
| **Chat** | `ws_ack_ms` | p95 **14 ms** (avg 7,21, med 5, p99 38 ms, max 188 ms) | ĐẠT (< 300 ms) |
| | Gửi / ack / nhận | 8 796 / 8 795 / 8 795 (46,3 tin/s), `ws_errors` 0, kết nối WS p95 123 ms | ĐẠT |
| **Relay outbox** | 8 816 event (`MessageSent` 8 806) | p50 537 ms, p95 **1 011 ms**, max 1 199 ms | ĐẠT (< 5 s) |
| **Đầu-cuối consumer** | `notification.on-message-sent` | **8 806/8 806** xử lý trong lượt; p50 1,68 s, p95 **2,69 s**, max 3,12 s | ĐẠT |
| **Tồn đọng** | outbox chưa relay sau lượt | 0 | ĐẠT |

Mọi ngưỡng k6 đạt (`k6` exit 0).

---

## Điểm nghẽn & đề xuất

### (a) Consumer pg-boss chỉ ~0,5 event/s — **đã sửa** (`packages/db/src/outbox/outbox-relay.ts`)

- **Nguyên nhân:** `registerConsumers` dùng `batchSize: 1` + `pollingIntervalSeconds: 2`; pg-boss 12 luôn chờ đủ nhịp
  polling giữa hai lần fetch → mỗi consumer tối đa ~0,5 event/s.
- **Hệ quả (lượt 1):** chat 46 tin/s dồn `evt.notification.on-message-sent` (hết lượt còn ~8 700 job, xả mất ~4,9 giờ);
  seed 100 cặp mất 391 s vì read model ứng viên (`matching.candidate-on-*`) cập nhật chậm — ở beta, mọi luồng chạy qua
  event (voucher, mở hội thoại, đóng match…) đều sẽ trễ khi có đợt tăng tải.
- **Sửa:** lấy lô 20 job (`CONSUMER_BATCH_SIZE`), `burstWhenBatchFull: true` (lô đầy → lấy tiếp ngay), `perJobResults:
  true` (kết quả theo từng job: event lỗi chỉ làm job đó thử lại / dead-letter, không kéo theo event khác trong lô).
  Event trong lô vẫn xử lý tuần tự, mỗi event một transaction `deliverOnce` (A9 giữ nguyên).
- **Kiểm chứng:** test tích hợp mới `outbox-relay.int.test.ts > consumer xả hàng đợi tồn đọng nhanh hơn 1 event / nhịp
  polling` (30 event, polling 2 s → xong ~2,3 s; trước đây ~60 s); test dead-letter cũ (AC2) vẫn pass; lượt 3 ở trên.

### (b) Đề xuất tiếp (chưa làm)

- Gộp/debounce push tin nhắn theo hội thoại (vd tối đa 1 push / hội thoại / 30 s khi người nhận offline) — mỗi tin chat
  hiện sinh 1 event + 1 job `notification.send`.
- Chạy worker ở container riêng và giới hạn pool kết nối của worker để consumer bắt kịp tải không tranh Postgres với API.
- Thêm theo dõi độ sâu hàng đợi pg-boss (không chỉ outbox) và `ws_ack_ms` vào dashboard/cảnh báo BE-S7-08.
- Đo lại trên staging khi có hạ tầng (D5): số đo trên là 1 instance api + 1 worker trên laptop, không phải staging.
