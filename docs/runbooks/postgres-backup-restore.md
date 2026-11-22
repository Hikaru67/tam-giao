# Runbook — Sao lưu & khôi phục Postgres

> BE-S7-08. Áp dụng cho staging (và làm khung cho production khi chốt D5). Dữ liệu chứa PII (Nghị định 13/2023):
> bản sao lưu **luôn mã hoá**, lưu ở bucket private riêng, chỉ người trực vận hành có quyền đọc.

## 1. Mục tiêu

| Môi trường | RPO (mất tối đa) | RTO (khôi phục trong) | Giữ |
|---|---|---|---|
| staging | 24 giờ | 4 giờ | 7 bản hằng ngày |
| production (đề xuất, chờ D5) | 5 phút (WAL/PITR) | 1 giờ | 30 ngày + 12 bản tháng |

Cột tiền/khoá mã hoá: dữ liệu `*_enc` chỉ giải mã được với đúng `DATA_MASTER_KEYS` → **sao lưu key ring riêng**
ở secret manager/KMS; mất key = mất dữ liệu mã hoá dù còn bản dump.

## 2. Ưu tiên: Postgres managed

Nếu dùng Postgres managed của nhà cung cấp: bật automated backup + PITR, giữ ≥ 7 ngày, bật mã hoá at-rest.
Khôi phục = tạo instance mới từ snapshot/thời điểm → đổi `DATABASE_URL` → chạy mục 5 (kiểm tra). Không khôi phục
đè lên instance đang chạy.

## 3. Tự host: sao lưu logic hằng ngày (`pg_dump`)

Chạy trên máy có quyền đọc DB (cron 02:00 giờ VN, trước job đối soát ledger 02:30):

```bash
#!/bin/sh
# /opt/tamgiao/backup.sh — cần: DATABASE_URL, BACKUP_BUCKET, BACKUP_GPG_RECIPIENT (khoá công khai của nhóm vận hành)
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="/var/backups/tamgiao-$STAMP.dump"
# -Fc: định dạng custom (nén, khôi phục chọn lọc, song song). Dùng image postgres cùng major version (16).
docker run --rm --network host -v /var/backups:/var/backups postgres:16-alpine \
  pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$DATABASE_URL"
gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$FILE.gpg" "$FILE"
rm -f "$FILE"
aws s3 cp "$FILE.gpg" "s3://$BACKUP_BUCKET/postgres/$STAMP.dump.gpg" --only-show-errors
sha256sum "$FILE.gpg" | aws s3 cp - "s3://$BACKUP_BUCKET/postgres/$STAMP.dump.gpg.sha256" --only-show-errors
find /var/backups -name 'tamgiao-*.dump.gpg' -mtime +2 -delete
```

- Bucket backup: private, versioning + lifecycle xoá sau 7 ngày (staging); tách tài khoản/khoá khỏi bucket ứng dụng.
- Cảnh báo nếu không có file mới trong 26 giờ (cron giám sát hoặc check của nhà cung cấp object storage).
- Dump gồm schema `drizzle` (lịch sử migration) và `pgboss` (hàng đợi) — khôi phục xong worker chạy tiếp được.

## 4. Khôi phục

> Không khôi phục đè DB đang phục vụ. Luôn khôi phục vào DB mới rồi chuyển `DATABASE_URL`.

```bash
# 1) Dừng ghi: tạm dừng worker + api (hoặc bật chế độ bảo trì ở reverse proxy)
cd /opt/tamgiao && docker compose stop worker api

# 2) Tải + kiểm tra + giải mã bản sao lưu
aws s3 cp s3://$BACKUP_BUCKET/postgres/<STAMP>.dump.gpg .
aws s3 cp s3://$BACKUP_BUCKET/postgres/<STAMP>.dump.gpg.sha256 - | sha256sum -c -
gpg --decrypt --output restore.dump <STAMP>.dump.gpg

# 3) Tạo DB mới và khôi phục (cùng major version 16)
psql "$ADMIN_URL" -c 'create database tamgiao_restore_<STAMP> owner tamgiao'
pg_restore --no-owner --no-privileges --jobs=4 --exit-on-error \
  --dbname="postgres://tamgiao:...@host:5432/tamgiao_restore_<STAMP>" restore.dump

# 4) Áp migration mới hơn bản dump (nếu có) — có advisory lock
DATABASE_URL=<url DB mới> docker compose run --rm -e DATABASE_URL migrate

# 5) Trỏ .env sang DB mới, khởi động lại, kiểm tra (mục 5)
docker compose up -d api worker
shred -u restore.dump
```

Bảng chỉ ghi thêm (`billing.ledger_entries`, `identity.audit_logs`, `matching.match_events`) có trigger chặn
UPDATE/DELETE — `pg_restore` chỉ INSERT nên không bị ảnh hưởng.

## 5. Kiểm tra sau khôi phục

```sql
select count(*) from drizzle.__drizzle_migrations;                        -- = số migration trong repo
select count(*) from platform.outbox where published_at is null;          -- outbox tồn đọng (worker sẽ relay tiếp)
select max(created_at) from identity.audit_logs;                          -- gần thời điểm sao lưu
```

- `GET /ready` = 200, chạy smoke test (`staging-deploy.md` mục 4).
- Chạy tay job đối soát ledger (BE-S4-07) — phải không có `MISMATCH`.
- Thông báo cho QA/FE khoảng thời gian dữ liệu bị mất (RPO thực tế).

## 6. Diễn tập

Mỗi tháng khôi phục bản mới nhất vào DB tạm, chạy mục 5, ghi thời gian thực tế (so với RTO) vào nhật ký vận hành,
rồi xoá DB tạm. Bản sao lưu chưa từng khôi phục thử = chưa có bản sao lưu.
