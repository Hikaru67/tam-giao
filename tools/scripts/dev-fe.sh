#!/bin/sh
# dev-fe.sh — Khởi động môi trường Backend local cho Frontend (FE-S1-05).
# Yêu cầu: Docker Desktop, Node.js (>=22.12), pnpm (>=12).
set -eu

# Chuyển về thư mục gốc của repository
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

# 1. Khởi động hạ tầng nền (Postgres, Redis, SeaweedFS) qua docker compose
echo "1. Khởi động các container trong docker-compose.yml..."
docker compose up -d

# 2. Chờ Postgres sẵn sàng (tối đa 60 giây)
echo "2. Đang chờ PostgreSQL sẵn sàng..."
RETRIES=0
MAX_RETRIES=60
until docker compose exec -T postgres pg_isready -U tamgiao -d tamgiao >/dev/null 2>&1 || [ "$RETRIES" -ge "$MAX_RETRIES" ]; do
  sleep 1
  RETRIES=$((RETRIES + 1))
done

if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
  echo "Lỗi: PostgreSQL không sẵn sàng sau ${MAX_RETRIES}s!" >&2
  exit 1
fi
echo "PostgreSQL đã sẵn sàng."

# 3. Chạy migration cơ sở dữ liệu
echo "3. Áp dụng database migration (pnpm db:migrate)..."
pnpm db:migrate

# 4. In thông tin URL và hướng dẫn
echo ""
echo "================================================================="
echo "   HỆ THỐNG BACKEND LOCAL ĐÃ KHỞI CHẠY THÀNH CÔNG"
echo "================================================================="
echo "  - API Base URL:       http://localhost:3000"
echo "  - API Docs (Swagger): http://localhost:3000/docs"
echo "  - Web Admin:          http://localhost:5173"
echo "  - Web Partner:        http://localhost:5174"
echo ""
echo "  Gợi ý chạy Mobile App:"
echo "    pnpm --filter @tamgiao/mobile dev"
echo ""
echo "  Gợi ý tạo dữ liệu kiểm thử (seed):"
echo "    pnpm seed:fe <scenario>    (onboarded | verified | offered | dating | date-confirmed)"
echo ""
echo "  Nhấn Ctrl+C để dừng API và Worker."
echo "================================================================="
echo ""

# 5. Thiết lập trap để khi nhận tín hiệu kết thúc (Ctrl+C, SIGINT, SIGTERM) sẽ dừng cả API và Worker
mkdir -p .run

# `cmd | tee &` cho `$!` là PID của tee, không phải api → dừng cả nhóm tiến trình của script khi thoát.
cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "Đang dừng API và Worker..."
  kill 0 2>/dev/null || true
}

trap cleanup INT TERM EXIT

# 6. Chạy song song API và Worker với RATE_LIMIT_ENABLED=false
# Ghi đồng thời ra terminal và file .run/api.log để seed:fe có thể tự động đọc mã OTP
# TRUST_PROXY=true chỉ ở dev: seed:fe gửi x-forwarded-for giả mỗi user để không vướng hạn mức OTP theo IP.
# Log api có SĐT test (dòng [sms:dev]) — `.run/` đã nằm trong .gitignore, chỉ dùng ở máy dev.
RATE_LIMIT_ENABLED=false TRUST_PROXY=true pnpm --filter @tamgiao/api dev 2>&1 | tee .run/api.log &
RATE_LIMIT_ENABLED=false pnpm --filter @tamgiao/worker dev &

wait
