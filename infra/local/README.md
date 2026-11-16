# Hạ tầng local

Chỉ dùng cho máy dev. Thông tin đăng nhập ở đây là **giá trị giả cho local**, không dùng ở staging/production.

| Dịch vụ | Image | Cổng host | Ghi chú |
|---|---|---|---|
| PostgreSQL | `postgres:16-alpine` | 5433 | db `tamgiao`, user/pass `tamgiao` |
| SeaweedFS (S3) | `chrislusf/seaweedfs:4.53` | 8333 (S3), 9333 (master) | key `tamgiao` / `tamgiao-local-secret` (file `seaweedfs-s3.json`) |
| storage-init | `amazon/aws-cli:2.40.3` | — | Tạo bucket `public-profile`, `private-kyc` rồi thoát |

```bash
docker compose up -d          # khởi động
docker compose ps             # postgres/seaweedfs phải "healthy", storage-init "exited (0)"
docker compose down -v        # xoá sạch dữ liệu local
```

Vì sao SeaweedFS mà không phải MinIO: image MinIO community không còn được phát hành trên Docker Hub/Quay
(kiểm tra ngày 2026-11-16). SeaweedFS (Apache-2.0) cung cấp API tương thích S3 nên adapter S3 không đổi.
