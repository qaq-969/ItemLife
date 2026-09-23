#!/usr/bin/env bash
# 生成随机密钥并写入 .env（不覆盖已有真实值，仅替换 change-me 占位符）
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[gen-secrets] 已从 .env.example 创建 .env"
fi

rand_b64() { openssl rand -base64 "$1" | tr -d '\n'; }
rand_hex() { openssl rand -hex "$1" | tr -d '\n'; }
# 口令会拼进 DATABASE_URL / REDIS_URL，必须用 URL 安全字符（base64url）
rand_pw() { openssl rand -base64 "$1" | tr -d '\n' | tr '+/' '-_'; }

replace_placeholder() {
  local key="$1" value="$2"
  # 仅在值为 change-me 开头（占位符）时替换
  if grep -qE "^${key}=change-me" .env; then
    sed -i.bak -E "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
    echo "[gen-secrets] ${key} 已生成"
  else
    echo "[gen-secrets] ${key} 已存在真实值，跳过"
  fi
}

get_value() {
  grep -E "^$1=" .env | head -1 | cut -d= -f2-
}

set_line() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env; then
    sed -i.bak -E "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

replace_placeholder DB_PASSWORD        "$(rand_pw 24)"
replace_placeholder DB_ROOT_PASSWORD   "$(rand_pw 24)"
replace_placeholder REDIS_PASSWORD     "$(rand_pw 24)"
replace_placeholder JWT_SECRET         "$(rand_hex 32)"
replace_placeholder JWT_REFRESH_SECRET "$(rand_hex 32)"
replace_placeholder TOTP_ENC_KEY       "$(rand_b64 32)"

# 连接串跟随已生成的用户名 / 口令重建（本地开发指向 127.0.0.1，
# 容器内运行时由 docker-compose.yml 覆盖为 mysql / redis 服务名）
set_line DATABASE_URL "mysql://$(get_value MYSQL_USER):$(get_value DB_PASSWORD)@127.0.0.1:3306/$(get_value MYSQL_DATABASE)"
set_line REDIS_URL "redis://:$(get_value REDIS_PASSWORD)@127.0.0.1:6379/0"
echo "[gen-secrets] DATABASE_URL / REDIS_URL 已重建"

echo "[gen-secrets] 完成，请妥善保管 .env（已被 .gitignore 忽略）"
