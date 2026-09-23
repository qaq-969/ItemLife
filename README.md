# ItemLife

以**物品为视角**的个人 / 家庭记账 Web 应用：既做常规收支记账与资产余额管理，又把支出与具体物品（及其配件）关联，回答「一件东西从买到用完，总共花了多少钱、每天成本是多少」。

- **设计报告（先读这份）**：[`docs/design-report.html`](docs/design-report.html)
- **目录结构说明（动手改代码前看）**：[`docs/project-structure.md`](docs/project-structure.md)
- **已确认决策**：成本三核心指标（总支付 / 当前持有成本 / 日均持有成本）、一笔流水多物品分摊、账户利息自动计算、内网部署 + 外部反向代理、仅 CNY（预留汇率扩展）

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vue 3 + TypeScript + Vite + Tailwind CSS v4 + Pinia + Vue Router + ECharts |
| 后端 | NestJS 11 + Prisma + MySQL 8.4 + Redis 7 |
| 安全 | Argon2id 口令哈希 · TOTP（AES-256-GCM 加密密钥）· 刷新令牌轮换（HttpOnly Cookie） |
| 部署 | Docker Compose（web / api / mysql / redis 四服务，frontend + backend 双网络） |

## 目录结构

```
itemlife/
├── apps/
│   ├── web/            # 前端 Vue 3（构建产物由 nginx 托管，并反代 /api）
│   └── api/            # 后端 NestJS（Prisma；启动时自动执行迁移）
├── packages/
│   └── shared/         # 前后端共享：金额工具、常量、DTO 类型
├── docs/               # 设计报告 + 目录结构说明
├── scripts/            # gen-secrets.sh / backup.sh
├── docker-compose.yml      # 生产编排
└── docker-compose.dev.yml  # 开发叠加（热重载）
```

## 快速开始（Docker，内网一键部署）

```bash
cp .env.example .env   # 或直接 make gen-secrets 自动生成随机密钥
make gen-secrets       # 生成数据库口令 / JWT 密钥 / TOTP 加密密钥
make up                # docker compose up -d --build
# 浏览器访问 http://<主机IP>/ ；公网访问由外部反向代理回源（见设计报告 10.5）
```

常用命令：`make logs` / `make down` / `make ps` / `make backup` / `make seed`

## 本地开发（热重载）

```bash
pnpm install                       # 安装工作区依赖（自动构建 packages/shared）
make infra                         # 仅启动 mysql + redis 容器
pnpm --filter @itemlife/api prisma:migrate   # 首次：建表
pnpm --filter @itemlife/api prisma:seed      # 首次：写入预置分类
pnpm dev:api                       # 终端 1：NestJS（http://localhost:3000，Swagger /api/docs）
pnpm dev:web                       # 终端 2：Vite（http://localhost:5173，/api 代理到 3000）
```

不依赖 MySQL / Redis 也能验证后端业务链路（内存替身 + 真实 HTTP 全链路断言）：

```bash
pnpm --filter @itemlife/api smoke:auth     # 认证：注册 → 登录 → MFA → 令牌旋转 等 37 项
pnpm --filter @itemlife/api smoke:ledger   # 记账：分类 / 账户余额 / 转账 / 分摊 / 结息 等 66 项
```

只做前端联调时可以不起数据库，用内存替身跑后端（数据重启即清空）：

```bash
pnpm --filter @itemlife/api dev:memory     # API http://127.0.0.1:3000/api/docs
pnpm --filter @itemlife/web dev            # 前端 http://127.0.0.1:5173
```

也可以在容器里开发（源码挂载 + 热重载，前后端一致的容器环境）：

```bash
make dev        # = docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
# 前端 http://localhost/（Vite Dev Server）· API http://localhost:3000/api/docs
# MySQL 3306 / Redis 6379 已暴露到宿主机，便于用客户端排查
make migrate    # 容器内执行 prisma migrate deploy
```

## 分支约定

- `main`：稳定分支（设计报告与发布版本）
- `beta-czw`：开发分支（框架搭建与功能迭代）

## 里程碑（详见设计报告第 12 章）

M1 骨架 + 认证 → M2 记账核心（含多物品分摊、利息） → M3 物品与配件成本 → M4 家庭协作 → M5 看板 → M6 加固与交付
