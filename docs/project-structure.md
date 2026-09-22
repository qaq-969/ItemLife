# ItemLife 目录结构说明

> 配套文档：[`design-report.html`](design-report.html)（系统设计报告，写「为什么这么设计」）·
> 本文档写「东西放在哪、新代码该往哪加」。
> 最后更新：2026-09-22（M1 认证模块完成后）。

## 0. 一句话总览

pnpm workspace 单仓多包（monorepo）：**前端 `apps/web`（Vue 3）· 后端 `apps/api`（NestJS）· 共享 `packages/shared`（TS 类型与纯函数）**，
加一份 Docker Compose 编排与一篇设计报告。三个包只有一个方向的数据流：`web → shared ← api`，
**前端不 import 后端源码，后端也不 import 前端源码**，两边只通过 `packages/shared` 的类型 + HTTP 契约（`/api/v1`）对齐。

## 1. 顶层结构

```
itemlife/
├── apps/
│   ├── web/                  # 前端 SPA（Vue 3 + Vite + Tailwind v4）
│   └── api/                  # 后端 HTTP 服务（NestJS + Prisma）
├── packages/
│   └── shared/               # 前后端共享：金额工具 / 常量 / 类型 / 口令强度规则
├── docs/                     # 文档：设计报告 + 本说明
├── scripts/                  # 仓库级运维脚本（与业务无关）
│   ├── gen-secrets.sh        #   生成随机口令与密钥写入 .env
│   ├── backup.sh             #   MySQL 逻辑备份
│   └── postinstall.mjs       #   pnpm install 后自动构建 shared
├── docker-compose.yml        # 生产编排：web + api + mysql + redis
├── docker-compose.dev.yml    # 开发叠加：源码挂载 + 热重载 + 端口外露
├── Makefile                  # 常用命令入口（make up / dev / migrate / seed / backup …）
├── .env.example              # 全部环境变量清单与注释（复制成 .env 使用）
├── pnpm-workspace.yaml       # workspace 成员声明
└── package.json              # 根脚本：dev:api / dev:web / build / typecheck
```

为什么用 monorepo：前后端要共用「金额精度规则、错误码、DTO 形状」这些会互相漂移的知识；
放在同一个仓库里，改共享类型时编译器会同时告诉两边哪里需要跟着改。

## 2. 三个包的职责边界

| 包 | 职责 | 不该做的事 |
| --- | --- | --- |
| `apps/web` | 界面渲染、交互、路由、调用 `/api/v1` | 不做金额计算口径的最终裁决（后端为准，前端只做即时提示） |
| `apps/api` | 业务规则、鉴权、数据持久化、对外 HTTP 契约 | 不关心页面长什么样、不返回 HTML |
| `packages/shared` | 纯函数 + 类型 + 常量，**无副作用、无依赖框架** | 不 import Vue / Nest / Prisma；不访问网络或数据库 |

**什么东西该放进 `packages/shared`**：两端都要用、且与运行环境无关的东西。当前有：

| 文件 | 内容 |
| --- | --- |
| `src/money.ts` | 金额换算与四舍五入（元 ↔ 分，整数分存储） |
| `src/constants.ts` | API 前缀、错误码、限额等常量 |
| `src/types.ts` | 跨端 DTO / 枚举类型 |
| `src/password.ts` | `PASSWORD_MIN_LENGTH` 与 `checkPasswordStrength()`（前端实时校验与后端注册校验共用同一份规则） |

判定标准：**「如果只写在前端，后端会不会有第二种写法？」会 → 放 shared。**

## 3. apps/web（前端）

```
apps/web/
├── index.html
├── vite.config.ts            # @ → src 别名；/api 开发代理到后端；shared 直接编译源码
├── nginx.conf                # 生产容器：托管静态资源 + 反代 /api 到 api 服务
├── src/
│   ├── main.ts               # 创建应用、挂 Pinia / Router、启动前 bootstrap 登录态
│   ├── App.vue
│   ├── api/                  # ★ 唯一的网络出口
│   │   ├── http.ts           #   axios 实例、Bearer 注入、401 静默续期、错误归一化、unwrap()
│   │   └── auth.ts           #   认证相关请求 + 类型（AuthUser / LoginPayload / …）
│   ├── stores/               # Pinia：跨页面共享状态
│   │   └── auth.ts           #   令牌（仅内存）、当前用户、MFA 票据、login/logout/bootstrap
│   ├── router/
│   │   └── index.ts          # 路由表 + 登录守卫（meta.public 放行、meta.title/nav 供外壳使用）
│   ├── layouts/
│   │   └── AppShell.vue      # 登录后的应用外壳（顶部栏 + 移动端底部导航）
│   ├── views/                # 页面级组件：一个路由一个文件
│   │   ├── auth/             #   LoginView / RegisterView / MfaVerifyView
│   │   ├── DashboardView.vue  ItemsView.vue  LedgerView.vue
│   │   ├── NewTransactionView.vue  FamilyView.vue
│   │   ├── MeView.vue  SecurityView.vue  SettingsView.vue
│   │   └── NotFoundView.vue
│   ├── components/           # 可复用小组件（AuthCard / PagePlaceholder）
│   ├── utils/                # 无状态辅助函数（navigation.ts）
│   └── assets/styles/main.css
└── tsconfig.json
```

约定：

- **页面放 `views/`，可复用片段放 `components/`**；只在单个页面用到的（哪怕是个大块）就留在该 view 里，不提前抽组件。
- **网络请求一律走 `src/api/`**：`http.ts` 负责 401 续期与错误归一化，`unwrap()` 把 `{code,message,data}` 包络拆开，让页面直接拿到 `data`。
- **令牌不落 localStorage**：access token 只存在 Pinia 内存（`stores/auth.ts`），刷新令牌在 HttpOnly Cookie 里，页面刷新后用 `bootstrap()` 静默续期。
- 新增一个页面：`views/` 建文件 → `router/index.ts` 注册路由（受保护页放进 `AppShell` 的 children）→ 需要后端数据就在 `api/` 加一个方法。

## 4. apps/api（后端）

```
apps/api/
├── prisma/
│   ├── schema.prisma         # 数据模型唯一真相（表名/列名用 snake_case，经 @map 映射）
│   ├── migrations/           # 迁移 SQL；容器启动时 prisma migrate deploy 自动执行
│   ├── seed.ts               # 预置数据（默认分类等）
│   └── ...
├── scripts/                  # 不参与构建的离线脚本
│   ├── auth-smoke.ts         #   认证链路冒烟（内存假 DB/Redis，无需 MySQL 即可跑）
│   └── support/in-memory.ts  #   上述脚本用的内存 Prisma / Redis 替身
├── src/
│   ├── main.ts               # 进程入口：读配置 → configureApp → listen
│   ├── app.setup.ts          # ★ 应用装配（管道/拦截器/过滤器/前缀/CORS/Swagger），main 与冒烟脚本共用
│   ├── app.module.ts         # 根模块：全局模块 + 两个 APP_GUARD（限流 → 鉴权）
│   ├── config/configuration.ts   # 环境变量 → 强类型配置对象（唯一读取 process.env 的地方）
│   ├── common/               # 与业务无关的横切能力
│   │   ├── filters/all-exceptions.filter.ts   # 异常 → {code,message,details} 统一错误体
│   │   ├── interceptors/transform.interceptor.ts # 成功响应 → {code:0,message:'ok',data} 包络
│   │   ├── guards/jwt-auth.guard.ts           # 全局登录守卫（@Public() 放行）
│   │   ├── decorators/                        # @Public() / @CurrentUser()
│   │   ├── types/auth-user.ts                 # 认证后的请求上下文类型
│   │   ├── crypto/                            # Argon2id 口令哈希、AES-256-GCM 密钥加密、随机数、SHA-256
│   │   ├── audit/                             # 安全审计事件落日志（单行 JSON）
│   │   ├── prisma/                            # PrismaService（连接生命周期）
│   │   ├── redis/                             # REDIS_CLIENT 提供者（ioredis）
│   │   └── utils/                             # id.ts（UUID ↔ BINARY(16)）、mask.ts（脱敏）、bigint-json.ts
│   └── modules/               # ★ 业务模块，一个功能域一个目录
│       ├── health/            #   健康检查（/health）
│       └── auth/              #   认证（见下）
├── nest-cli.json  tsconfig.json  tsconfig.build.json
└── Dockerfile  docker-entrypoint.sh   # 容器入口：等 DB → 迁移 → 启动
```

### 4.1 分层与调用方向

```
HTTP 请求
  → 全局中间件（cookieParser）        main/app.setup 里装配
  → 全局守卫  ThrottlerGuard（限流）→ JwtAuthGuard（鉴权）
  → 控制器 Controller                 只做 HTTP 契约：取参、调 service、写 Cookie、选状态码
  → 服务 Service                      业务规则的唯一落点（事务、幂等、错误码都在这层）
  → 能力提供者（TokenService / MfaService / CryptoService / LoginThrottleService）
  → 基础设施（PrismaService / REDIS_CLIENT）
  → 全局拦截器 TransformInterceptor（包络成功响应）
  → 全局过滤器 AllExceptionsFilter（包络异常）
```

规则：

- **Controller 不写业务判断，Service 不碰 `req`/`res`**；需要在控制器里落地的只有 Cookie 这类 HTTP 细节（`auth.cookie.ts`）。
- **错误一律用 `HttpException` + 业务错误码**（如 `PASSWORD_TOO_WEAK` / `INVALID_CREDENTIALS` / `REFRESH_TOKEN_REUSED`），由 `AllExceptionsFilter` 统一成型；不要手工 `res.status().json()`。
- **对外默认需要登录**。新增公开端点必须显式加 `@Public()`，并配合 `@Throttle()` 收紧额度。
- **双层校验**：DTO 用 class-validator 挡住形状问题（格式、长度上限），业务强度类规则放 Service（这样错误码才稳定、可被前端识别）。

### 4.2 auth 模块（M1 已完成，可当模板照抄）

```
modules/auth/
├── auth.module.ts             # 模块装配（JwtModule.register({}) + 各服务）；导出 TokenService 供其他模块吊销会话
├── auth.controller.ts         # 路由：register / login / mfa/verify / token/refresh / logout(+all) / me / mfa/*
├── auth.service.ts            # 编排：注册、两段式登录、刷新、登出、MFA 绑定/关闭
├── token.service.ts           # 访问令牌签发与校验、MFA 票据、刷新令牌轮换与盗用检测
├── mfa.service.ts             # TOTP 密钥生成/加密存储、动态码校验与防重放、恢复码
├── login-throttle.service.ts  # 按「账号 + IP」失败计数与指数退避锁定
├── auth.cookie.ts             # 刷新令牌 Cookie 的读写与清除（HttpOnly / SameSite / Path）
├── auth.constants.ts          # 本模块常量（TTL、窗口、码长等）
├── device.decorator.ts        # 从请求里提取 IP / User-Agent
└── dto/
    ├── auth.dto.ts            # 入参 DTO（class-validator + Swagger 装饰器）
    ├── mfa.dto.ts             # MFA 相关入参
    └── auth.vo.ts             # 出参 VO：决定「什么字段可以被返回」，避免哈希/密钥外泄
```

### 4.3 新增一个业务模块（Checklist）

以 M2 的 `LedgerModule` 为例：

1. `modules/ledger/` 建四件套：`ledger.module.ts` / `ledger.controller.ts` / `ledger.service.ts` / `dto/`。
2. 在 `app.module.ts` 的 `imports` 里注册（注释里已列出 M2+ 规划：Ledger / Item / Family / Dashboard / User）。
3. 数据模型改 `prisma/schema.prisma`，然后 `pnpm --filter @itemlife/api prisma:migrate`（生成迁移 SQL 并应用）。
4. 控制器默认就受 `JwtAuthGuard` 保护；需要用当前用户就 `@CurrentUser()` 取 `{ id, sessionId, mfa }`。
5. 权限判定（个人 / 家庭空间归属）写在 Service，并统一抛业务错误码；跨表写入一律放进 `$transaction`。
6. 需要审计的敏感操作调用 `AuditService.record('域.动作', {...})`（字段值先脱敏）。
7. 类型若两端都要用，加进 `packages/shared/src/types.ts`，不要各写一份。

## 5. 环境变量与配置

- 唯一清单在 `.env.example`；**代码里只在 `src/config/configuration.ts` 读 `process.env`**，其余地方用 `ConfigService.get('点分路径')`。
- 生产/开发/测试共用同一套变量名，差异靠 compose 文件与 `.env` 值表达。
- 敏感值（JWT 密钥、TOTP 加密密钥、数据库口令）由 `make gen-secrets` 生成，只存在于 `.env`，**不入库、不入 Git**。

## 6. 容器与网络（与目录结构相关的部分）

| 位置 | 说明 |
| --- | --- |
| `apps/web/nginx.conf` | 生产镜像内：静态资源 + `/api` 反代到 `api:3000`，前后端同源，Cookie 不需跨域设置 |
| `apps/api/docker-entrypoint.sh` | 启动前等待数据库可用 → `prisma migrate deploy` → 启动 Node |
| `docker-compose.yml` | 四服务两网络：`frontend` 对外、`backend` 内部（mysql/redis 只在 backend） |
| `docker-compose.dev.yml` | 叠加使用：源码挂载 + 热重载 + 暴露 3306/6379 便于本地排查 |

## 7. 质量与验证入口

| 命令 | 作用 |
| --- | --- |
| `pnpm typecheck` | 三个包一起做类型检查 |
| `pnpm build` | shared → web → api 全量构建 |
| `pnpm --filter @itemlife/api smoke:auth` | **认证链路离线冒烟**：内存假 DB/Redis 启动真实 Nest 应用，跑完注册 → 登录 → MFA → 恢复码 → 令牌旋转/盗用 → 锁定 → 登出共 37 项断言 |
| `make up` / `make dev` | 生产 / 开发容器编排（需 Docker 守护进程） |
| `pnpm --filter @itemlife/api prisma:studio` | 可视化查看数据 |

冒烟脚本为什么做成「内存替身 + 真实 HTTP」：可以在没有 MySQL / Redis（例如本机未启动 Docker）的情况下验证
守卫、管道、拦截器、Cookie、TOTP、令牌轮换这些**真实代码路径**，而不是只测 mock。

## 8. 命名与风格约定

- 文件与目录：`kebab-case`（`login-throttle.service.ts`）；类：`PascalCase`；其余标识符 `camelCase`。
- 数据库表名/列名 `snake_case`，Prisma 侧用 `@map` / `@@map` 映射，代码里保持 camelCase。
- 金额一律「整数分 + `BIGINT`」，禁止浮点参与结算；时间统一 `DateTime(3)`（UTC 存储）。
- 主键统一 `BINARY(16)`（UUID 二进制），代码里通过 `common/utils/id.ts` 的 `newId()` / `toIdBytes()` / `bytesToUuid()` 转换。
- 注释只写「为什么」，不复述代码在做什么。

## 9. 当前进度与已知偏差

- 已完成：monorepo 骨架、共享包、Docker 编排、**M1 认证模块**——后端注册 / 两段式登录 / TOTP 绑定与校验 /
  恢复码 / 刷新令牌轮换与盗用检测 / 失败锁定 / 登出全链路，前端登录、注册、两步验证、安全设置（MFA 绑定与恢复码展示）四个页面。
- 与设计报告的一处**有意偏差**：报告流程 A 写「注册后自动签发待开启 MFA 的会话」，实现改为**注册后跳登录页**
  （`/login?registered=1`），原因是自动登录会让「注册 → 引导绑定 MFA」多一次令牌往返，收益低而状态分支多；绑定 MFA 仍可在登录后由安全页触发。
- 尚未验证：`make up` 的容器内端到端（本机 Docker 守护进程未启动）。首次在目标内网部署时，按设计报告第 10 章的部署清单复核一遍。
