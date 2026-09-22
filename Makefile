.PHONY: up down logs ps build restart gen-secrets dev infra migrate seed backup sh-api sh-mysql

# ---------- 生产：一键启动 / 停止 ----------
up:
	docker compose up -d --build

down:
	docker compose down

restart: down up

ps:
	docker compose ps

logs:
	docker compose logs -f --tail=100

build:
	docker compose build

# ---------- 开发：热重载叠加文件 ----------
dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# 本地开发（不在容器内跑代码）时只起依赖服务
infra:
	docker compose up -d mysql redis

# ---------- 数据库：迁移与种子 ----------
PRISMA_SCHEMA := apps/api/prisma/schema.prisma

migrate:
	docker compose exec api apps/api/node_modules/.bin/prisma migrate deploy --schema $(PRISMA_SCHEMA)

seed:
	docker compose exec api apps/api/node_modules/.bin/ts-node --transpile-only apps/api/prisma/seed.ts

backup:
	./scripts/backup.sh

# ---------- 运维辅助 ----------
sh-api:
	docker compose exec api sh

sh-mysql:
	docker compose exec mysql sh -lc 'mysql -uroot -p"$$MYSQL_ROOT_PASSWORD" "$$MYSQL_DATABASE"'

# 生成随机密钥并写回 .env（仅覆盖空值 / change-me 占位符）
gen-secrets:
	@bash scripts/gen-secrets.sh
