# 邮箱验证与忘记密码可行性报告

> 调研日期：2026-10-10。本文只确定后续实现方案，本次迭代不接入邮件服务。

## 结论

可行，现有 NestJS、Prisma、Redis 和 Argon2id 认证结构无需重写。建议增加一层通用 SMTP 邮件发送器，首选验证 ItemLife 自有域名后从 `no-reply@itemlife.20040507.xyz` 发信；服务商可以在 Amazon SES、Resend 或其他支持 SMTP 的平台之间替换，业务代码不绑定厂商 API。

第一期先完成邮箱所有权验证，第二期复用同一套令牌表和邮件通道完成“忘记密码”。密码重置不应关闭 MFA；用户丢失 MFA 时继续使用现有恢复码或由站点管理员人工处理。

## 为什么适合当前项目

- Nodemailer 的 SMTP transport 只需要主机、端口、TLS 和账号密码，SMTP 服务商可以只改环境变量，不需要改业务流程。[Nodemailer SMTP 文档](https://nodemailer.com/smtp)
- Amazon SES 和主流邮件服务都要求先验证发件域名，并通过 DNS 配置 DKIM/SPF；SES 的 SMTP 端点要求 TLS，支持 587 STARTTLS 和 465 TLS。[Amazon SES 域名验证](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-verification.html) · [Amazon SES SMTP TLS](https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html)
- OWASP 推荐忘记密码使用密码学安全的随机 URL 令牌，令牌应单次、限时、安全存储，并对存在和不存在的邮箱返回相同响应。[OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)

## 推荐数据结构

在 `users` 增加 `email_verified_at`，再增加一张统一令牌表：

```text
account_tokens
  id                BINARY(16)
  user_id           BINARY(16)
  purpose           verify_email | reset_password
  token_hash        CHAR(64) UNIQUE
  expires_at        DATETIME(3)
  used_at           DATETIME(3) NULL
  created_at        DATETIME(3)
```

邮件内发送 32 字节随机令牌原文，数据库只保存 SHA-256 哈希。验证邮箱建议 24 小时有效；重置密码建议 30 分钟有效。签发新令牌时废止同一用户、同一用途的旧令牌。

## 建议流程

### 新用户邮箱验证

1. 注册仍执行现有邮箱格式、密码强度、邀请码和首位超级管理员规则。
2. 新用户写入数据库后签发 `verify_email` 令牌并发送验证链接。
3. 普通新用户在验证前不允许登录；提供“重新发送验证邮件”，按邮箱和 IP 限流。
4. 验证成功写入 `email_verified_at`，令牌立即失效。
5. 为保证升级兼容，已有用户不应在迁移后突然被锁定：迁移时先视为已验证，随后可在“我的”中主动重新验证真实邮箱。

首位超级管理员是部署恢复入口。若邮件尚未配置成功，不应让站点卡在无法登录的状态；建议首位超级管理员保留当前直接登录能力，并在站点管理页持续提示完成邮箱验证。

### 忘记密码

1. `POST /auth/password/forgot` 无论邮箱是否存在都返回相同文案和相近耗时，避免枚举用户。
2. 对 IP 和标准化邮箱双重限流；存在且已验证时生成 `reset_password` 令牌并发送 HTTPS 链接。
3. 链接只使用配置项 `APP_PUBLIC_URL` 生成，不读取请求 `Host`；重置页面设置 `Referrer-Policy: no-referrer`。
4. 用户提交两次新密码，继续使用当前统一强度规则和 Argon2id。
5. 成功后令牌作废，撤销全部刷新令牌，要求用户重新登录，并发送一封不含密码的变更通知邮件。

## 部署配置

后续 Compose 只需给 API 增加环境变量，不增加新容器：

```dotenv
APP_PUBLIC_URL=https://itemlife.20040507.xyz
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASSWORD=...
MAIL_FROM=ItemLife <no-reply@itemlife.20040507.xyz>
```

NAS 必须能向外连接 SMTP 587 或 465。不要使用 25 端口作为默认方案；部分网络会限制该端口。SMTP 密码只放 `.env`，不写入镜像或仓库。

## 上线前检查

- 发件域名的 DKIM、SPF 与 DMARC 正常，测试 QQ、163、Gmail 和 Outlook 的到达率与垃圾箱情况。
- 请求接口不泄露邮箱是否存在，邮件发送失败只写脱敏日志。
- 令牌单次、过期、并发重发、暴力尝试和会话撤销均有自动化测试。
- 邮件链接只指向配置的 HTTPS 域名；两个生产域名若都可访问，选择一个规范主域名生成链接，另一个只做跳转。
