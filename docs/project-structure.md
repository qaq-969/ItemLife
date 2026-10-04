# ItemLife 目录结构说明

> 配套文档：[`current-requirements.md`](current-requirements.md)（当前实现与验收基线）·
> [`design-report.html`](design-report.html)（系统设计报告，写「为什么这么设计」）·
> 本文档写「东西放在哪、新代码该往哪加」。
> 最后更新：2026-10-04（M4 家庭协作与 M5 综合看板完成后）。

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
| `src/money.ts` | 金额换算与四舍五入（元 ↔ 分，整数分存储）、`interestFromDailySum()`（单利按日累计） |
| `src/constants.ts` | API 前缀、错误码、限额、`INTEREST_FREQ_MONTHS`、`SYSTEM_TAGS`、预置分类 |
| `src/types.ts` | 跨端 DTO / 枚举类型（含 `TransactionDto` / `AccountSummaryDto` / `InterestRunResult`） |
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
│   │   ├── auth.ts           #   认证相关请求 + 类型（AuthUser / LoginPayload / …）
│   │   ├── ledger.ts         #   记账域请求 + 类型：accounts / categories / transactions / interestApi
│   │   ├── items.ts          #   物品域请求 + 类型：itemsApi（使用 / 撤销、物品 overview）
│   │   ├── family.ts         #   家庭、邀请和成员请求
│   │   └── dashboard.ts      #   综合看板汇总、趋势与占比请求
│   ├── stores/               # Pinia：跨页面共享状态
│   │   ├── auth.ts           #   令牌（仅内存）、当前用户、MFA 票据、login/logout/bootstrap
│   │   ├── ledger.ts         #   当前数据域的账户 / 分类 / 汇总缓存
│   │   └── domain.ts         #   个人 / 家庭全局选择、家庭列表与本地偏好
│   ├── router/
│   │   └── index.ts          # 路由表 + 登录守卫（meta.public 放行、meta.title/nav 供外壳使用）
│   ├── layouts/
│   │   └── AppShell.vue      # 登录后的应用外壳（顶部栏 + 移动端底部导航）
│   ├── views/                # 页面级组件：一个路由一个文件
│   │   ├── auth/             #   LoginView / RegisterView / MfaVerifyView
│   │   ├── LedgerView.vue  NewTransactionView.vue
│   │   ├── AccountsView.vue  CategoriesView.vue
│   │   ├── ItemsView.vue  ItemDetailView.vue  ItemFormView.vue
│   │   ├── DashboardView.vue  FamilyView.vue
│   │   ├── MeView.vue  SecurityView.vue  SettingsView.vue
│   │   └── NotFoundView.vue
│   ├── components/           # 可复用小组件（AuthCard / PagePlaceholder / AppModal）
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
│   ├── ledger-smoke.ts       #   记账核心冒烟（分类 / 账户 / 流水 / 转账 / 结息）
│   ├── items-smoke.ts        #   物品与配件冒烟（成本指标 / 配件消耗审计 / 看板 / 分摊关联）
│   └── support/
│       ├── mini-prisma.ts    #   通用内存 Prisma 引擎（按 schema 建表 + 关系解析）
│       └── in-memory.ts      #   本仓库的表定义与 Redis 替身
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
│   │   ├── scope/                             # ★ 数据域（个人 / 家庭）解析与越权 404
│   │   ├── crypto/                            # Argon2id 口令哈希、AES-256-GCM 密钥加密、随机数、SHA-256
│   │   ├── audit/                             # 安全审计事件落日志（单行 JSON）
│   │   ├── prisma/                            # PrismaService（连接生命周期）
│   │   ├── redis/                             # REDIS_CLIENT 提供者（ioredis）
│   │   ├── dto/owner-body.dto.ts              # 请求体里的 owner:{type,id}（与 ?domain= 等价）
│   │   └── utils/                             # id.ts（UUID ↔ BINARY(16)）、date.ts（UTC 天/月运算）、
│   │                                          # cursor.ts（游标编解码）、mask.ts、bigint-json.ts
│   └── modules/               # ★ 业务模块，一个功能域一个目录
│       ├── health/            #   健康检查（/health）
│       ├── auth/              #   认证（见 4.2）
│       ├── categories/        #   分类树 + 预置 + 排序 + 停用（见 4.4）
│       ├── accounts/          #   账户 CRUD + 派生余额 + 计息配置（见 4.4）
│       ├── transactions/      #   记一笔 / 转账 / 分摊 / 列表筛选 / 小计（见 4.4）
│       ├── interest/          #   结息：Cron 自动 + 手动预览与入账（见 4.4）
│       ├── items/             #   物品 / 配件库存与审计 / 成本指标 / 物品看板（见 4.5）
│       ├── family/            #   M4 家庭、邀请码和成员权限
│       └── dashboard/         #   M5 收入 / 支出 / 总资产趋势与占比聚合
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
  → 能力提供者（TokenService / MfaService / BalanceService / InterestService / CostService / …）
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

以 M2 的 `TransactionsModule` 为例：

1. `modules/<域>/` 建四件套：`<域>.module.ts` / `<域>.controller.ts` / `<域>.service.ts` / `dto/`（入参 DTO + 出参 VO）。
2. 在 `app.module.ts` 的 `imports` 里注册（注释里已列出 M2+ 规划：Item / Family / Dashboard / User）。
3. 数据模型改 `prisma/schema.prisma`，然后 `pnpm --filter @itemlife/api prisma:migrate`（生成迁移 SQL 并应用）。
4. 控制器默认就受 `JwtAuthGuard` 保护；需要用当前用户就 `@CurrentUser()` 取 `{ id, sessionId, mfa }`。
5. 数据域（个人 / 家庭）一律经 `OwnerScopeService` 解析，Service 用 `scopes.filter(scope)` 拼查询条件；
   越权与不存在必须返回**同一个** 404（见 4.4）。
6. 跨表写入一律放进 `$transaction`；需要审计的操作调 `AuditService.record('域.动作', {...})`（字段值先脱敏）。
7. 类型若两端都要用，加进 `packages/shared/src/types.ts`，不要各写一份。
8. 在 `scripts/ledger-smoke.ts` 里补一组断言，然后 `pnpm --filter @itemlife/api smoke:ledger` 验证。

### 4.4 记账核心（M2）中的几个关键约定

数据域（`common/scope/`）：每条账户 / 分类 / 流水 / 物品记录都带 `owner_type('user'|'household') + owner_id(BINARY(16))`。
查询用 `?domain=household:<uuid>`，写请求用请求体 `owner: { type, id }`（`common/dto/owner-body.dto.ts`）。
**资源级 404 必须与「记录不存在」同码**：`resolveOwned()` 的 `onDenied` 参数把越权收敛成 `TRANSACTION_NOT_FOUND`
这类资源码；若「无权」与「不存在」返回不同 code，就能被用来逐个探测他人的记录是否存在。
只有数据域本身越权（`?domain=household:<uuid>` 且不是成员）才用 `SCOPE_NOT_FOUND`。

余额是**派生值**（`balance.service.ts`）：`初始余额 + Σ收入 − Σ支出 + Σ转入 − Σ转出`，全部基于 `deleted_at IS NULL` 的行实时聚合，
没有余额列，因此删流水 / 改金额后余额自动回滚，不需要补偿逻辑。

转账（`transactions.service.ts`）：入参只写 `type='transfer_out'` + `toAccountId`，落库为**共享 `transfer_group_id` 的两条腿**；
改金额 / 改时间 / 删流水都按组整体处理，避免单腿残留导致余额对不上。

分摊（`transaction_items`）：一笔流水可关联多个物品，`amount_minor=NULL` 表示「整笔归该物品」；
校验规则（重复物品 / 漏填金额 / 分摊合计超出）在 `resolveAllocations()`。

幂等（两种场景两套机制）：`Idempotency-Key` 请求头走 Redis（`SET NX` 预约 → 记住结果），Redis 不可用时降级为不拦截；
结息走数据库乐观锁 `updateMany({ where: { id, interestPostedAt: 原值 } })`，重跑 / 多实例并发只有一个能抢到。

结息口径（`interest.service.ts`）：区间 = `[上次结息日 + 1, 今天]`，`dueAt = 锚点 + 周期` 只决定自动任务何时触发；
入账后锚点推进到今天，因此「同一天重跑」区间为空 → 400 `INTEREST_PERIOD_EMPTY`，绝不重复入账。

### 4.5 物品与配件（M3）中的几个关键约定

**成本指标只有一个实现**（`packages/shared/src/cost.ts` + `modules/items/cost.service.ts`）：
公式写在 shared，`CostService` 只负责批量取数与聚合，列表 / 详情 / 看板 / 前端折线共用同一口径，禁止在页面里另算一份。
三核心 = 总支付（本体 + Σ 配件单价×总数）、当前持有成本（本体 + Σ 单价×已用数）、日均持有成本（持有成本 ÷ 持有天数）；
两辅助 = 配件库存价值（Σ 单价×剩余数）、预计日均成本（总支付 ÷ 预期寿命天数，未填则为 `null`）。
「持有天数」= 今天 − 购买日 + 1（按 UTC 天算，最小 1），所以购买当天就是 1 天。

**配件消耗必须留痕**（`accessory_usages`）：每次「使用 / 撤销」写一行审计（`delta_qty` 正负 + 变更后的 `used_qty_after` + 操作人），
`item_accessories.used_qty` 与 Σ`delta_qty` 必须恒等；建档时若填了「已用数量」也会补一条初始审计，保证这条不变式从第一天起成立。
消耗 / 撤销走**乐观锁**：`$transaction` 内 `updateMany({ where: { id, usedQty: 当前值 }, data: { usedQty: 新值 } })`，
`count === 0` → 409 `ACCESSORY_CONFLICT`（并发下不会把库存扣成负数）；超额 → 400 `ACCESSORY_QTY_EXCEEDED` / `ACCESSORY_RESTORE_EXCEEDED`。

**成本演进折线**（`CostService.timelineOf`）：以购买日的本体价起步，把审计按 UTC 天聚合成台阶（使用抬升、撤销回落），
最后补一个「今天」的点让折线延伸到当前；同一天多次变更合并成一点，所以折线点数 = 有变更的天数 + 1~2。

**删除语义**：物品本身保留软删标记，但对应的流水分摊会同步移除；共享流水按被删分摊实时扣减，金额归零才删除整笔流水。
删除由流水创建的物品、配件或配件批次时，同样沿来源关系清理跨流水子项。删除配件批次等价于撤销该批次的使用状态：批次、使用/恢复记录和来源分摊一起移除，
物品页不提供追加配件批次入口。物品列表 `GET /items` 是游标分页，看板用不分页的 `GET /items/overview`。
「一笔流水 → 多物品」及任意层级子项落在 `transaction_items`，流水列表可用 `?itemId=` 反查；分摊树既负责追溯，也作为物品成本与联动删除的来源关系。

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
| `pnpm --filter @itemlife/api smoke:ledger` | **记账核心离线冒烟**：预置分类 → 分类增删改排序 → 账户与派生余额 → 记一笔与分摊校验 → 转账联动 → 改删回滚 → 列表筛选分页小计 → 幂等键 → 结息幂等 → 数据域隔离，共 66 项断言 |
| `pnpm --filter @itemlife/api smoke:items` | **物品与配件离线冒烟**：牙刷成本验收 → 消耗 / 撤销与审计 → 批次联动删除 → 看板 → 多级流水归属 → 金额余数分配 → 跨页面删除同步 → 数据域隔离，共 82 项断言 |
| `pnpm --filter @itemlife/api smoke:m4m5` | **家庭与综合看板离线冒烟**：创建 / 改名 / 三级权限 / 邀请 / 成员管理 / 事务删除 / 数据隔离 → 区间汇总 / 收支与总资产趋势 / 分类占比 / 物品投入，共 46 项断言 |
| `make up` / `make dev` | 生产 / 开发容器编排（需 Docker 守护进程） |
| `pnpm --filter @itemlife/api prisma:studio` | 可视化查看数据 |

冒烟脚本为什么做成「内存替身 + 真实 HTTP」：可以在没有 MySQL / Redis（例如本机未启动 Docker）的情况下验证
守卫、管道、拦截器、Cookie、TOTP、令牌轮换、派生余额、转账成对写入、结息幂等这些**真实代码路径**，而不是只测 mock。

内存引擎的注意点（`scripts/support/mini-prisma.ts`）：它是**按运行时值类型匹配**的简化实现（Uint8Array 比字节、Date 比时间戳），
只覆盖本仓库实际用到的查询形态。新增查询若用到 `where` 之外的 Prisma 特性（如 `_avg`、`distinct`、`having`），
要么在引擎里补，要么把断言改成走真实 MySQL。关系过滤 `some / every / none` 已支持（`matchWhere` 里递归解析），
物品域的「一笔流水反查物品」就是这么断言的；`where` 里新增关系形态时先补这里，否则冒烟会静默漏测。

## 8. 命名与风格约定

- 文件与目录：`kebab-case`（`login-throttle.service.ts`）；类：`PascalCase`；其余标识符 `camelCase`。
- 数据库表名/列名 `snake_case`，Prisma 侧用 `@map` / `@@map` 映射，代码里保持 camelCase。
- 金额一律「整数分 + `BIGINT`」，禁止浮点参与结算；时间统一 `DateTime(3)`（UTC 存储）。
- 主键统一 `BINARY(16)`（UUID 二进制），代码里通过 `common/utils/id.ts` 的 `newId()` / `toIdBytes()` / `bytesToUuid()` 转换。
- 注释只写「为什么」，不复述代码在做什么。

## 9. 当前进度与已知偏差

- 已完成：monorepo 骨架、共享包、Docker 编排、**M1 认证模块**——后端注册 / 两段式登录 / TOTP 绑定与校验 /
  恢复码 / 刷新令牌轮换与盗用检测 / 失败锁定 / 登出全链路，前端登录、注册、两步验证、安全设置（MFA 绑定与恢复码展示）四个页面。
- 已完成（后端）：**M2 记账核心**——数据域（个人 / 家庭）、分类树与预置分类、账户与派生余额、计息配置、
  记一笔（收 / 支 / 转账 + 多物品分摊 + 幂等键 + 游标分页 + 区间小计）、利息自动结息与手动结息。
  离线冒烟 `smoke:ledger` 66 项、`smoke:auth` 37 项全绿；`pnpm typecheck` 无错误。
- 已完成（前端）：**M2 记账核心**——请求层 `api/ledger.ts` 与 Pinia `stores/ledger.ts`（账户 / 分类 / 汇总缓存与单飞刷新）、
  通用底部弹层 `components/AppModal.vue`、账户管理页（余额汇总 + 计息配置 + 手动结息预览）、
  分类管理页（两级树 + 增删改 + 上移/下移排序 + 停用过滤）、记一笔（收 / 支 / 转账三态）、
  流水列表（筛选 / 游标分页 / 编辑 / 删除）、设置页入口改造。
- 前端已验收：账户新建（含年化 1.75% / 每月结息）、收入支出转账三类流水落库、
  转账成对写入与删除连带回滚（银行 12 000 / 现金 1 300 → 删转账后 13 200 / 275.47）、
  26 笔游标翻页无重复无遗漏、区间小计随筛选与编辑实时同步、分类停用后不再出现在记账选择器、
  排序刷新后仍保持、有流水的分类删除被 409 拦截并提示改「停用」。
- 已完成（后端）：**M3 物品与配件**——物品档案、通过流水创建的配件批次、任意层级物品归属与双向联动删除、
  使用 / 撤销审计（`accessory_usages`，乐观锁防并发超扣）、成本指标唯一入口 `CostService`（三核心 + 两辅助 + 成本演进台阶）、
  看板 `GET /items/overview`、流水分摊反查 `GET /transactions?itemId=`。离线冒烟 `smoke:items` 82 项全绿。
- 已完成（前端）：**M3 物品与配件**——`api/items.ts` 请求层、物品列表 / 看板页（总览三数 + 日均成本排行 + 状态与关键字筛选 + 游标翻页）、
  物品详情页（六格指标 + ECharts 台阶折线 + 配件进度条与使用 / 撤销 / 删除批次 + 使用审计 + 关联流水）、
  物品编辑页（状态、分类与预期寿命）、记一笔的**多物品任意层级归属树**
  （新建/关联物品、附加物品/费用、配件数量、金额余数自动守恒、超出金额前端拦截）。
- 前端已验收（M3，2026-09-23，`dev:memory` + 浏览器）：牙刷建档 400 + 12×20 已用 2 →
  总支付 ¥640.00 / 当前持有 ¥440.00 / 日均 ¥4.40（100 天）/ 配件库存 ¥200.00、预计日均 ¥1.60（寿命 400 天）与第 8.2 节公式逐项一致；
  使用 1 → 460.00（审计「使用 1（余 3）」）、撤销 1 → 440.00（「撤销 1（余 2）」）；成本演进折线随消耗刷新且 tooltip 数值与接口一致；
  编辑购买日 / 分类 / 预期寿命后指标随之重算；记一笔单物品分摊（¥100.00）与多物品分摊（¥140.00 + ¥60.00 / 共 2 件）分别落库，
  分摊合计超过流水金额时前端直接报错；物品看板 2 件在册汇总 ¥700.00 / ¥500.00 / ¥200.00 与排行（牙刷 4.40 > 沐浴露 1.11）一致。
- 已完成（M4）：`family/` 提供家庭创建/改名/永久删除、8 位邀请码生成/失效/加入、创建者/管理员/成员三级权限与成员管理；
  `stores/domain.ts` 将当前个人/家庭域持久化，并由应用外壳统一驱动账户、分类、流水、记一笔、物品和看板读写。
  家庭创建时复制预置分类；邀请码只在生成时返回明文，库内仅保存 SHA-256；数据域越权统一为 404。家庭删除以名称二次确认，
  在一个事务中清理账务、物品、库存、邀请和成员数据。
- 已完成（M5）：`dashboard/` 从流水、派生账户余额和 `ItemsService` 成本口径聚合支出、收入、储蓄、收益、总资产、
  上期对比、日/周/月趋势、分类占比和账户分布；前端“收支与总资产趋势”同时绘制三条曲线，并提供物品投入、近期流水和表格替代视图。
- M4/M5 离线验收：`smoke:m4m5` 覆盖两账号加入家庭、邀请码失效、成员隔离、家庭/个人数据域、区间汇总、趋势、
  分类占比、账户余额与物品投入，以及家庭删改和管理员权限，共 46 项断言。
- 前端未覆盖：结息**有计息天数**时的预览渲染（内存环境当天开户算不出天数，数值口径由 `smoke:ledger` 覆盖）；
  M4/M5 的正式浏览器多账号、多视口自动化仍归入 M6，当前由生产构建、响应式样式静态复核和离线 HTTP 冒烟保证。
- 与设计报告的一处**有意偏差**：报告流程 A 写「注册后自动签发待开启 MFA 的会话」，实现改为**注册后跳登录页**
  （`/login?registered=1`），原因是自动登录会让「注册 → 引导绑定 MFA」多一次令牌往返，收益低而状态分支多；绑定 MFA 仍可在登录后由安全页触发。
- 另一处**有意偏差**：报告 8.5 写「入账后把 `interest_posted_at` 推进至结息日」，实现推进至**今天**，
  即区间终点始终是今天（按实际天数计息）；这样预览金额 = 立即入账金额，服务停机数日后重跑能补上这几天的利息，不会漏算。
- 一处**接口契约细节**：`GET /categories?includeArchived=false` 与省略参数等价。查询串里的布尔值经全局
  `enableImplicitConversion` 会先被转成 `Boolean('false') === true`，因此该字段用 `@Transform` 回读原始入参显式解析
  （见 `categories/dto/category-list.dto.ts` 的注释），`smoke:ledger` 有对应回归断言。
- 容器基线已在本机 Docker Desktop 验证；每次发布仅重建受影响的 `web` / `api` 镜像，并以健康检查确认替换成功。
