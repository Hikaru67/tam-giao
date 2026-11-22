# syntax=docker/dockerfile:1
#
# Image apps/api (BE-S7-08) — build từ root repo:
#   docker build -f apps/api/Dockerfile --build-arg APP_RELEASE=$(git rev-parse HEAD) -t tamgiao-api .
# Chạy:      docker run --env-file .env -p 3000:3000 tamgiao-api
# Migration: docker run --rm --env-file .env tamgiao-api migrate   (advisory lock, chạy trước khi rollout)
#
# Copy cả workspace (lọc bằng .dockerignore) rồi `pnpm install --filter-prod @tamgiao/api...` → chỉ cài phụ thuộc
# production của api + các package workspace nó dùng (`--filter-prod` bỏ qua devDependencies như
# @tamgiao/testing). Thêm module mới không cần sửa file này.
# Mã TypeScript chạy trực tiếp bằng tsx (package workspace export `src/*.ts`, không có bước build riêng).

ARG NODE_VERSION=22.23.2

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /repo

# 1) Cài phụ thuộc production của api + các package workspace nó dùng. Store pnpm nằm ở cache mount của
#    BuildKit (tái dùng giữa các lần build, không lọt vào image); `--filter-prod` không kéo devDependencies.
FROM base AS build
COPY . .
RUN --mount=type=cache,id=tamgiao-pnpm-store,target=/pnpm/store \
    corepack install \
 && pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --package-import-method copy \
      --filter-prod "@tamgiao/api..."

# 2) Runtime: không có pnpm/corepack store, chạy bằng user không phải root (`node`, uid 1000).
FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP_RELEASE=dev
ENV NODE_ENV=production \
    APP_RELEASE=${APP_RELEASE} \
    API_PORT=3000
RUN apk add --no-cache tini
WORKDIR /app
# Mã + node_modules thuộc root, chỉ đọc với user chạy app.
COPY --from=build /repo /app
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${API_PORT}/health" || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["serve"]
