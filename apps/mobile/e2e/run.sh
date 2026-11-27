#!/usr/bin/env bash
# Chạy E2E mobile bằng Maestro trên Android emulator nối BE local (FE-S6-01).
#
#   apps/mobile/e2e/run.sh helper-start      # nạp tests/e2e/local.env + tests/e2e/.run/admin.env, chạy helper nền, chờ /health
#   apps/mobile/e2e/run.sh helper-stop
#   apps/mobile/e2e/run.sh test [N]          # adb reverse + chạy flow tổng N lần liên tiếp (mặc định 1), dừng ở lần fail đầu
#   apps/mobile/e2e/run.sh ci <apk>          # helper-start → adb install -r <apk> → test 3 → helper-stop (trap EXIT)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
E2E_DIR="$ROOT/apps/mobile/e2e"
RUN_DIR="${MOBILE_E2E_RUN_DIR:-$E2E_DIR/.run}"
mkdir -p "$RUN_DIR"
HELPER_PORT="${E2E_HELPER_PORT:-3199}"

cmd_helper_start() {
  local pidfile="$RUN_DIR/helper.pid"
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    return 0
  fi

  local admin_env="$ROOT/tests/e2e/.run/admin.env"
  if [[ ! -f "$admin_env" ]]; then
    echo "thiếu $admin_env — chạy tests/e2e/run-local.sh up trước" >&2
    exit 1
  fi

  set -a
  # shellcheck source=/dev/null
  source "$ROOT/tests/e2e/local.env"
  # shellcheck source=/dev/null
  source "$admin_env"
  set +a

  export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:${API_PORT}}"
  export E2E_OTP_LOG_FILE="${E2E_OTP_LOG_FILE:-$ROOT/tests/e2e/.run/api.log}"
  export E2E_WEBHOOK_SECRET="${E2E_WEBHOOK_SECRET:-$PAYMENT_WEBHOOK_SECRET}"
  export E2E_EVENT_TIMEOUT_MS="${E2E_EVENT_TIMEOUT_MS:-60000}"
  export E2E_HELPER_PORT="$HELPER_PORT"

  (cd "$ROOT/tests/e2e" && exec node --import tsx "$E2E_DIR/helper/server.ts") >"$RUN_DIR/helper.log" 2>&1 &
  echo $! >"$pidfile"

  local health_url="http://127.0.0.1:$HELPER_PORT/health"
  for _ in $(seq 1 30); do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      echo "helper sẵn sàng: $health_url (log: $RUN_DIR/helper.log)"
      return 0
    fi
    sleep 1
  done

  echo "helper không sẵn sàng sau 30s — xem $RUN_DIR/helper.log" >&2
  exit 1
}

cmd_helper_stop() {
  local pidfile="$RUN_DIR/helper.pid"
  if [[ -f "$pidfile" ]]; then
    kill "$(cat "$pidfile")" 2>/dev/null || true
    rm -f "$pidfile"
  fi
}

cmd_test() {
  local count="${1:-1}"
  # URL presigned S3 từ API trỏ localhost:58333 — chuyển cổng về host cho emulator.
  adb reverse tcp:58333 tcp:58333

  for i in $(seq 1 "$count"); do
    if maestro test \
      -e HELPER_URL="http://127.0.0.1:$HELPER_PORT" \
      --format junit \
      --output "$RUN_DIR/report-$i.xml" \
      --debug-output "$RUN_DIR/debug-$i" \
      "$E2E_DIR/flows/full-journey.yaml"; then
      echo "=== Maestro lượt $i/$count: PASS ==="
    else
      echo "=== Maestro lượt $i/$count: FAIL ===" >&2
      exit 1
    fi
  done
}

cmd_ci() {
  local apk="${1:-}"
  if [[ -z "$apk" ]]; then
    echo "cần đường dẫn APK: $0 ci <apk>" >&2
    exit 2
  fi
  cmd_helper_start
  trap cmd_helper_stop EXIT
  adb install -r "$apk"
  cmd_test 3
}

case "${1:-}" in
  helper-start) cmd_helper_start ;;
  helper-stop) cmd_helper_stop ;;
  test) cmd_test "${2:-1}" ;;
  ci) cmd_ci "${2:-}" ;;
  *)
    sed -n '2,7p' "$0"
    exit 2
    ;;
esac
