# Runbook — Deploy staging

> BE-S7-08. Hạ tầng chưa chốt (D5): pipeline không gắn nhà cung cấp. Yêu cầu tối thiểu: 1 registry OCI +
> 1 máy Linux có Docker Engine + Compose v2, truy cập SSH; Postgres 16, Redis 7, object storage S3-compatible
> (managed hoặc tự host).

## 1. Luồng tự động

`.github/workflows/deploy-staging.yml` chạy khi workflow **CI** xanh trên `main` (sau merge PR sprint) hoặc chạy tay
(`workflow_dispatch`):

1. **build** — build `apps/api/Dockerfile`, `apps/worker/Dockerfile` (multi-stage, user `node` không phải root,
   chỉ phụ thuộc production) → push `<REGISTRY>/<IMAGE_REPOSITORY>-{api,worker}:<git sha>` và tag `staging`.
2. **deploy** — SSH vào máy staging: `docker compose pull` → `docker compose run --rm migrate` (migration có
   **advisory lock** `hashtext('tamgiao.migrations')`, chờ tối đa `MIGRATION_LOCK_TIMEOUT_MS`) →
   `docker compose up -d api worker` → chờ `GET /ready` = 200.
3. **smoke** — `pnpm --filter @tamgiao/tools smoke:staging`: `/health`, `/ready`, `POST /auth/otp/request` →
   đọc mã từ log SMS giả của container api (`[sms:dev] …`) → `POST /auth/otp/verify` → `GET /auth/sessions` với token.
   Sau đó kiểm tra `/metrics` (nếu có `METRICS_TOKEN`) và tải `openapi.json` thành artifact `openapi-<sha>`.

Deploy chồng nhau: `concurrency: deploy-staging` xếp hàng; kể cả khi chạy tay song song, advisory lock bảo đảm chỉ
một tiến trình migrate tại một thời điểm.

## 2. Cấu hình GitHub (Environment `staging`)

| Loại | Tên | Ví dụ |
|---|---|---|
| var | `REGISTRY` | `ghcr.io`, `registry.example.vn` |
| var | `IMAGE_REPOSITORY` | `my-org/tamgiao` |
| var | `STAGING_API_URL` | `https://api.staging.example.vn` |
| var | `STAGING_DEPLOY_DIR` | `/opt/tamgiao` |
| secret | `REGISTRY_USERNAME`, `REGISTRY_PASSWORD` | token push/pull registry |
| secret | `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY` | user `deploy` thuộc nhóm `docker` |
| secret | `STAGING_SSH_KNOWN_HOSTS` | `ssh-keyscan -H <host>` (kiểm tra fingerprint tay) |
| secret | `METRICS_TOKEN` | tuỳ chọn, trùng giá trị trên máy staging |

## 3. Dựng máy staging (một lần)

1. Cài Docker Engine + Compose v2, tạo user `deploy` (nhóm `docker`), thêm public key của workflow.
2. Reverse proxy TLS (Caddy/Nginx) → `127.0.0.1:3000`; chặn `/metrics` từ internet (hoặc để bearer token).
3. `mkdir -p /opt/tamgiao && cd /opt/tamgiao`, chép `docs/runbooks/staging/compose.yml` thành `compose.yml`.
4. Tạo `/opt/tamgiao/.env` (quyền `600`, **không commit**) từ `.env.example`, thay:
   - `REGISTRY_IMAGE=<REGISTRY>/<IMAGE_REPOSITORY>` (dùng cho interpolation của compose).
   - `NODE_ENV=development` — staging dùng provider giả (SMS console, eKYC fake, cổng thanh toán fake) mà config
     **cấm khi `NODE_ENV=production`**; phân biệt môi trường bằng `SENTRY_ENVIRONMENT=staging`.
   - `DATABASE_URL`, `REDIS_URL`, `S3_*` trỏ tới dịch vụ staging; `DATA_MASTER_KEYS`, `BLIND_INDEX_KEY`,
     `AUTH_SECRET`, `PAYMENT_WEBHOOK_SECRET` sinh mới (`openssl rand -base64 32`), lưu ở secret manager.
   - `SENTRY_DSN` (project staging), `METRICS_TOKEN`, `PUBLIC_API_URL`, `CORS_ORIGINS`, `TRUST_PROXY=true`.
5. Tạo bucket `public-profile`, `private-kyc` (private, không public-read).
6. Chạy workflow tay một lần (`Actions → Deploy staging → Run workflow`).

## 4. Kiểm tra sau deploy

```bash
curl -fsS https://api.staging.example.vn/ready          # {"status":"ready",...}
curl -fsS https://api.staging.example.vn/openapi.json   # tài liệu API (FE xem ở /docs)
SMOKE_BASE_URL=https://api.staging.example.vn \
SMOKE_OTP_COMMAND='ssh deploy@host "cd /opt/tamgiao && docker compose logs --since 5m api"' \
  pnpm --filter @tamgiao/tools smoke:staging
```

## 5. Rollback

Migration chỉ thêm (AGENTS.md mục 4) nên rollback image là đủ trong đa số trường hợp:

```bash
cd /opt/tamgiao
IMAGE_TAG=<sha-trước> docker compose up -d api worker
```

Migration làm hỏng dữ liệu → khôi phục theo `postgres-backup-restore.md` (PITR tới trước thời điểm deploy).

## 6. Chạy thử image ở máy dev

```bash
docker build -f apps/api/Dockerfile -t tamgiao-api .
docker build -f apps/worker/Dockerfile -t tamgiao-worker .
docker run --rm --env-file .env tamgiao-api migrate
docker run --rm --env-file .env -p 3000:3000 tamgiao-api
```

`localhost` trong `.env` là của container — dùng `host.docker.internal` hoặc chung network với Postgres/Redis.
