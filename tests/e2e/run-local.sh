#!/usr/bin/env bash
# Chạy e2e + k6 trên stack local (BE-S7-09) — staging thật chưa có (D5).
#
#   tests/e2e/run-local.sh up      # hạ tầng (compose tamgiao-e2e) + migrate + seed chuyên viên + api/worker nền
#   tests/e2e/run-local.sh e2e     # e2e toàn luồng 2 người dùng + 1 chuyên viên
#   tests/e2e/run-local.sh seed    # seed cặp DATING cho k6 (LOAD_PAIRS, mặc định 100 cặp = 200 người dùng)
#   tests/e2e/run-local.sh load    # k6 (grafana/k6 qua Docker nếu máy không có k6) + đo relay outbox
#   tests/e2e/run-local.sh outbox  # chỉ in số đo relay outbox
#   tests/e2e/run-local.sh down    # dừng api/worker, xoá hạ tầng
#   tests/e2e/run-local.sh all     # up → e2e → seed → load → down
#
# Cần: Docker (Desktop) + pnpm. Docker Desktop trên macOS: thêm /Applications/Docker.app/Contents/Resources/bin vào PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_DIR="${E2E_RUN_DIR:-$ROOT/tests/e2e/.run}"
COMPOSE=(docker compose -f "$ROOT/tests/e2e/compose.yml" -p tamgiao-e2e)
mkdir -p "$RUN_DIR"

load_env() {
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/tests/e2e/local.env"
  set +a
}

wait_ready() {
  local url="http://localhost:${API_PORT}/ready"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "API không sẵn sàng sau 60s — xem $RUN_DIR/api.log" >&2
  return 1
}

start_app() { # $1 = api | worker
  local app="$1"
  if [[ -f "$RUN_DIR/$app.pid" ]] && kill -0 "$(cat "$RUN_DIR/$app.pid")" 2>/dev/null; then return 0; fi
  (cd "$ROOT/apps/$app" && exec node --import tsx src/main.ts) >"$RUN_DIR/$app.log" 2>&1 &
  echo $! >"$RUN_DIR/$app.pid"
}

stop_app() {
  local pidfile="$RUN_DIR/$1.pid"
  if [[ -f "$pidfile" ]]; then
    kill "$(cat "$pidfile")" 2>/dev/null || true
    rm -f "$pidfile"
  fi
}

cmd_up() {
  load_env
  "${COMPOSE[@]}" up -d --wait postgres redis seaweedfs
  "${COMPOSE[@]}" run --rm storage-init >/dev/null
  (cd "$ROOT/apps/api" && node --import tsx src/migrate.ts)

  # Chuyên viên (role ADMIN = có mọi quyền: duyệt eKYC, ghép đôi, quản lý quán) — mật khẩu ngẫu nhiên mỗi lần up.
  if [[ ! -f "$RUN_DIR/admin.env" ]]; then
    local email="e2e-admin-$(date +%s)@tamgiao.test"
    local password
    password="$(openssl rand -hex 16)"
    local output
    output="$(printf '%s\n' "$password" | (cd "$ROOT/tools" && node --import tsx scripts/seed-admin.ts --email "$email" --role ADMIN))"
    local secret
    secret="$(sed -n 's/.*[?&]secret=\([A-Z2-7]*\).*/\1/p' <<<"$output" | head -1)"
    [[ -n "$secret" ]] || { echo "seed-admin không trả về TOTP secret" >&2; exit 1; }
    umask 077
    printf 'E2E_ADMIN_EMAIL=%s\nE2E_ADMIN_PASSWORD=%s\nE2E_ADMIN_TOTP_SECRET=%s\n' "$email" "$password" "$secret" \
      >"$RUN_DIR/admin.env"
  fi

  start_app api
  start_app worker
  wait_ready
  echo "stack sẵn sàng: http://localhost:${API_PORT} (log: $RUN_DIR/{api,worker}.log)"
}

e2e_env() {
  load_env
  set -a
  # shellcheck source=/dev/null
  source "$RUN_DIR/admin.env"
  set +a
  export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:${API_PORT}}"
  export E2E_OTP_LOG_FILE="${E2E_OTP_LOG_FILE:-$RUN_DIR/api.log}"
  export E2E_WEBHOOK_SECRET="${E2E_WEBHOOK_SECRET:-$PAYMENT_WEBHOOK_SECRET}"
  export E2E_FORWARDED_FOR="${E2E_FORWARDED_FOR:-true}"
}

cmd_e2e() {
  e2e_env
  (cd "$ROOT/tests/e2e" && node --import tsx src/full-flow.ts)
}

cmd_seed() {
  e2e_env
  export LOAD_OUTPUT="${LOAD_OUTPUT:-$RUN_DIR/load-users.json}"
  (cd "$ROOT/tests/e2e" && node --import tsx src/seed-load.ts)
}

cmd_outbox() {
  local since="${1:-${OUTBOX_SINCE:-1970-01-01T00:00:00Z}}"
  "${COMPOSE[@]}" exec -T postgres psql -U tamgiao -d tamgiao -v ON_ERROR_STOP=1 -v since="$since" \
    -f - <"$ROOT/tests/load/outbox-latency.sql"
}

cmd_load() {
  load_env
  local since
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local summary="$RUN_DIR/k6-summary.json"
  local users="$RUN_DIR/load-users.json"
  [[ -f "$users" ]] || { echo "chưa có $users — chạy '$0 seed' trước" >&2; exit 1; }
  local k6_status=0
  set +e
  if command -v k6 >/dev/null 2>&1; then
    K6_BASE_URL="http://localhost:${API_PORT}" LOAD_USERS_FILE="$users" \
      k6 run --summary-export "$summary" "$ROOT/tests/load/chat-and-api.js"
    k6_status=$?
  else
    docker run --rm -i \
      -v "$ROOT/tests/load:/scripts:ro" -v "$RUN_DIR:/run-data" \
      -e K6_BASE_URL="http://host.docker.internal:${API_PORT}" -e LOAD_USERS_FILE=/run-data/load-users.json \
      -e CHAT_VUS -e CHAT_INTERVAL_MS -e API_RPS -e LOAD_DURATION \
      grafana/k6:1.4.2 run --summary-export /run-data/k6-summary.json /scripts/chat-and-api.js
    k6_status=$?
  fi
  set -e
  echo "— relay outbox trong lượt tải (từ $since) —"
  cmd_outbox "$since"
  return "$k6_status"
}

cmd_down() {
  stop_app api
  stop_app worker
  "${COMPOSE[@]}" down -v --remove-orphans
  rm -f "$RUN_DIR/admin.env"
}

case "${1:-}" in
  up) cmd_up ;;
  e2e) cmd_e2e ;;
  seed) cmd_seed ;;
  load) cmd_load ;;
  outbox) cmd_outbox "${2:-}" ;;
  down) cmd_down ;;
  all)
    cmd_up
    trap cmd_down EXIT
    cmd_e2e
    cmd_seed
    cmd_load
    ;;
  *)
    sed -n '2,12p' "$0"
    exit 2
    ;;
esac
