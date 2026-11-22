# syntax=docker/dockerfile:1
#
# Image apps/worker (BE-S7-08) — build từ root repo:
#   docker build -f apps/worker/Dockerfile --build-arg APP_RELEASE=$(git rev-parse HEAD) -t tamgiao-worker .
# Chạy: docker run --env-file .env tamgiao-worker
#
# Giống apps/api/Dockerfile: copy cả workspace (lọc bằng .dockerignore), cài phụ thuộc production của
# `@tamgiao/worker...` → thêm module mới không cần sửa file này. Migration chạy bằng image api (`migrate`).

ARG NODE_VERSION=22.23.2

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /repo

# 1) Cài phụ thuộc production của worker + các package workspace nó dùng. Store pnpm nằm ở cache mount của
#    BuildKit (tái dùng giữa các lần build, không lọt vào image); `--filter-prod` không kéo devDependencies.
FROM base AS build
COPY . .
RUN --mount=type=cache,id=tamgiao-pnpm-store,target=/pnpm/store \
    corepack install \
 && pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --package-import-method copy \
      --filter-prod "@tamgiao/worker..."

# 2) Runtime: chạy bằng user không phải root (`node`, uid 1000), mã thuộc root (chỉ đọc).
FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP_RELEASE=dev
ENV NODE_ENV=production \
    APP_RELEASE=${APP_RELEASE}
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=build /repo /app
USER node
WORKDIR /app/apps/worker
# Worker không mở cổng HTTP; liveness = tiến trình còn chạy (tini chuyển SIGTERM để shutdown êm).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "tsx", "src/main.ts"]
