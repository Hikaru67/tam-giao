# Tâm Giao — Backend

[![CI](https://github.com/Hikaru67/tam-giao/actions/workflows/ci.yml/badge.svg)](https://github.com/Hikaru67/tam-giao/actions/workflows/ci.yml)

Nền tảng mai mối hôn nhân xác thực 1-1. Monorepo TypeScript theo Clean Architecture + modular monolith.

- Luật cho mọi agent/dev: [`AGENTS.md`](AGENTS.md)
- Kiến trúc: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Backlog theo sprint: [`docs/backlog/README.md`](docs/backlog/README.md)
- Thiết kế UI (Stitch): [`design/stitch`](design/stitch)

## Bắt đầu

Yêu cầu: Node 22 (`.nvmrc`), pnpm (qua corepack), Docker.

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up -d        # Postgres + SeaweedFS (S3), xem infra/local/README.md
pnpm db:migrate
pnpm dev                    # api + worker
```

## Kiểm chứng (AGENTS.md mục 8)

```bash
pnpm typecheck
pnpm lint
pnpm test          # unit
pnpm test:int      # tích hợp, cần Docker (Testcontainers)
```
