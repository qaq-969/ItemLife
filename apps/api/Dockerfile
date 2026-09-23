# syntax=docker/dockerfile:1

# ---------------- 构建阶段 ----------------
FROM node:24-alpine AS builder

RUN corepack enable
WORKDIR /repo

# 1) 依赖层（利用构建缓存）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

# 2) 源码与构建（Prisma Client 需在构建期生成）
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @itemlife/shared build \
 && pnpm --filter @itemlife/api exec prisma generate \
 && pnpm --filter @itemlife/api build

# ---------------- 运行阶段 ----------------
FROM node:24-alpine AS runner

ENV NODE_ENV=production
RUN apk add --no-cache tini && corepack enable
WORKDIR /repo

# 工作区依赖（pnpm 的软链接结构需保持相对路径）
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /repo/packages/shared ./packages/shared
COPY --from=builder /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/apps/api/prisma ./apps/api/prisma

COPY apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]

# ---------------- 开发阶段（compose 开发叠加：热重载，源码由卷挂载覆盖） ----------------
FROM node:24-alpine AS dev

RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @itemlife/shared build \
 && pnpm --filter @itemlife/api exec prisma generate

EXPOSE 3000
CMD ["pnpm", "--filter", "@itemlife/api", "start:dev"]
