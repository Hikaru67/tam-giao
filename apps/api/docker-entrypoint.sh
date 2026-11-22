#!/bin/sh
# Entrypoint image api (BE-S7-08): `serve` (mặc định) | `migrate` | lệnh bất kỳ.
set -eu

case "${1:-serve}" in
  serve)
    exec node --import tsx src/main.ts
    ;;
  migrate)
    # Migration có advisory lock (src/migrate.ts) — an toàn khi nhiều tiến trình chạy cùng lúc.
    exec node --import tsx src/migrate.ts
    ;;
  *)
    exec "$@"
    ;;
esac
