# Hạ tầng local

Chỉ dùng cho máy dev. Thông tin đăng nhập ở đây là **giá trị giả cho local**, không dùng ở staging/production.
Mọi cổng chỉ mở trên `127.0.0.1` (không lộ ra mạng LAN).

| Dịch vụ | Image | Cổng host | Ghi chú |
|---|---|---|---|
| PostgreSQL | `postgres:16-alpine` | 5433 | db/user `tamgiao`, **không mật khẩu** (`trust`) |
| SeaweedFS (S3) | `chrislusf/seaweedfs:4.53` | 8333 (S3), 9333 (master) | key `tamgiao` / `tamgiao-local-secret` (file `seaweedfs-s3.json`) |
| storage-init | `amazon/aws-cli:2.40.3` | — | Tạo bucket `public-profile`, `private-kyc` rồi thoát |

```bash
docker compose up -d          # khởi động
docker compose ps             # postgres/seaweedfs phải "healthy", storage-init "exited (0)"
docker compose down -v        # xoá sạch dữ liệu local
```

Vì sao SeaweedFS mà không phải MinIO: image MinIO community không còn được phát hành trên Docker Hub/Quay
(kiểm tra ngày 2026-11-16). SeaweedFS (Apache-2.0) cung cấp API tương thích S3 nên adapter S3 không đổi.

## Test tích hợp (Testcontainers)

`pnpm test:int` tự khởi động một Postgres riêng qua Testcontainers (không dùng container của compose).
Trên macOS với Docker Desktop, PATH phải có thư mục credential helper, nếu không sẽ gặp
`spawn docker-credential-desktop ENOENT`:

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

## Migration

```bash
pnpm db:generate --name <ten_ngan>   # sinh SQL từ schema Drizzle → migrations/ (review SQL trước khi commit)
pnpm db:migrate                      # áp dụng vào DATABASE_URL trong .env
```
