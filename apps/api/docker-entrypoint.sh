#!/bin/sh
# 容器启动：迁移 →（可选）种子 → 启动服务
set -e

SCHEMA="apps/api/prisma/schema.prisma"
PRISMA_BIN="apps/api/node_modules/.bin/prisma"

echo "[api] 执行数据库迁移（prisma migrate deploy）…"
"$PRISMA_BIN" migrate deploy --schema "$SCHEMA"

if [ "${SEED_ON_START:-0}" = "1" ]; then
  echo "[api] 写入种子数据（SEED_ON_START=1）…"
  apps/api/node_modules/.bin/ts-node --transpile-only apps/api/prisma/seed.ts
fi

echo "[api] 启动 NestJS…"
exec node apps/api/dist/main.js
