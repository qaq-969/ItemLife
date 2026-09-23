# ---------- 依赖与开发（热重载） ----------
FROM node:24-alpine AS dev
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @itemlife/shared build

EXPOSE 5173
CMD ["pnpm", "--filter", "@itemlife/web", "dev", "--host", "0.0.0.0"]

# ---------- 构建静态产物 ----------
FROM dev AS builder
RUN pnpm --filter @itemlife/web build

# ---------- 运行：Nginx 托管静态文件并代理 /api ----------
FROM nginx:stable-alpine AS prod
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
COPY --from=builder /repo/apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
