#!/usr/bin/env bash
# MySQL 逻辑备份：mysqldump --single-transaction → gzip → 保留 30 天
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a
: "${MYSQL_DATABASE:=itemlife}"
: "${MYSQL_USER:=itemlife}"
: "${DB_PASSWORD:?DB_PASSWORD 未设置，请先配置 .env}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
OUT="${BACKUP_DIR}/${MYSQL_DATABASE}_${STAMP}.sql.gz"

echo "[backup] 开始备份 → ${OUT}"
docker compose exec -T mysql \
  mysqldump --single-transaction --quick --default-character-set=utf8mb4 \
  -u"${MYSQL_USER}" -p"${DB_PASSWORD}" "${MYSQL_DATABASE}" | gzip > "$OUT"

echo "[backup] 清理 ${RETENTION_DAYS} 天前的旧备份"
find "$BACKUP_DIR" -name "${MYSQL_DATABASE}_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] 完成：$(du -h "$OUT" | cut -f1)"
