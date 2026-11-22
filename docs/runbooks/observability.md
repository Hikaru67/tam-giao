# Runbook — Observability (lỗi, metric, cảnh báo)

> BE-S7-08. Mã: `apps/api/src/observability/`, `apps/worker/src/observability/`.

## 1. Theo dõi lỗi (Sentry)

- Port `ErrorReporter` + adapter `SentryErrorReporter`; thiếu `SENTRY_DSN` → `NoopErrorReporter` (không gửi gì).
- Mọi `logger.error/fatal` (kể cả logger con theo request, job worker lỗi, relay outbox lỗi) và lỗi không bắt
  (uncaught / unhandled rejection) được gửi lên Sentry. Chỉ gửi Error + câu log, **không** gửi object ngữ cảnh log.
- Scrub PII trước khi gửi (`scrubEvent`): bỏ user (trừ id), cookie, header (trừ user-agent/content-type…),
  body, query string, biến cục bộ của stack frame, `server_name`; khoá nhạy cảm (`phone`, `cccd`, `otp`, `token`,
  `income`, `email`, `ip`…) → `[REDACTED]`; chuỗi tự do che SĐT VN, CCCD 12 số, email, JWT, mã 6 số.
- Biến: `SENTRY_DSN`, `SENTRY_ENVIRONMENT` (mặc định = `NODE_ENV`; staging đặt `staging`), `APP_RELEASE` (image
  gán sẵn git sha).

## 2. Metric (Prometheus) — `GET /metrics` của API

Bật mặc định (`METRICS_ENABLED`), có `METRICS_TOKEN` thì cần `Authorization: Bearer <token>`.

| Metric | Loại | Ý nghĩa |
|---|---|---|
| `http_request_duration_seconds{method,route,status}` | histogram | Độ trễ; `route` là route mẫu (`/me/match/:id`), 404 = `unmatched` |
| `http_server_errors_total{method,route}` | counter | Số response 5xx |
| `job_queue_depth{queue,state}` | gauge | Job pg-boss `created`/`retry`/`active` theo hàng đợi (đọc lúc scrape) |
| `outbox_unpublished_events` | gauge | Event outbox chưa relay |
| `outbox_oldest_unpublished_age_seconds` | gauge | Tuổi event chưa relay lâu nhất |
| `process_*`, `nodejs_*` | — | Metric mặc định của prom-client |

Luật cảnh báo mẫu: `docs/runbooks/staging/prometheus-alerts.yml`.

## 3. Cảnh báo outbox tồn đọng (worker)

`OutboxBacklogMonitor` chạy trong worker mỗi `OUTBOX_BACKLOG_CHECK_INTERVAL_SECONDS` (60): số event chưa relay
> `OUTBOX_BACKLOG_MAX_EVENTS` (500) **hoặc** event cũ nhất > `OUTBOX_BACKLOG_MAX_AGE_SECONDS` (300) → log `error`
`outbox backlog above threshold` + cảnh báo Sentry (level warning). Còn tồn đọng thì nhắc lại mỗi
`OUTBOX_BACKLOG_REALERT_MINUTES` (15); hết tồn đọng → log `outbox backlog recovered`.

### Outbox tồn đọng

1. Worker còn chạy? `docker compose ps worker`, `docker compose logs --since 15m worker | grep -i error`.
2. Relay lỗi (`outbox relay failed`) → xem lỗi DB/pg-boss; khởi động lại worker (`docker compose restart worker`)
   — relay idempotent (`FOR UPDATE SKIP LOCKED`, id job cố định), chạy lại không sinh trùng.
3. Tuổi tăng nhưng số lượng thấp → một event kẹt: `select id, event_type, created_at from platform.outbox
   where published_at is null order by created_at limit 20;` (không đọc `payload` nếu không cần — có thể chứa dữ liệu
   nghiệp vụ).
4. Số lượng cao, tuổi thấp → tải đột biến; theo dõi tới khi về dưới ngưỡng, cân nhắc tăng replica worker.

## 4. OpenAPI

`GET /openapi.json` (OpenAPI 3.1) + `GET /docs` (Scalar) — bật mặc định trừ `NODE_ENV=production`
(`OPENAPI_ENABLED`). Danh mục endpoint lấy từ router thật; `components.schemas` = mọi Zod schema của
`@tamgiao/contracts` (tên `verifyOtpBodySchema` → `VerifyOtpBody`). Mỗi lần deploy staging, workflow lưu
`openapi.json` thành artifact `openapi-<sha>`.
