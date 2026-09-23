# ItemLife UI Prototype

`beta-html-jl` 是 ItemLife 的静态界面设计分支，用于在接入业务功能前确认整体视觉方向。

## 当前设计

- 主色：雾霭紫 `#8877C7`
- 辅色：燕麦白 `#F0E7DB`
- 认证页配色：暮山蓝 `#4A5F8C`、晚桃粉 `#E8B4A2`
- 视觉：半透明毛玻璃、柔和植物投影、低饱和暖色背景
- 页面：首页看板、资产概览、月度指标、最近流水、常用物品与侧边导航
- 认证页面：登录、注册、MFA 两步验证三份独立静态设计
- 响应式：支持桌面、平板和手机宽度

## 本地预览

直接打开根目录的 [`index.html`](./index.html) 即可查看。

认证页面可分别打开：

- [`login.html`](./login.html) — 登录
- [`register.html`](./register.html) — 注册
- [`mfa.html`](./mfa.html) — MFA 两步验证

也可以在仓库目录启动任意静态文件服务器，例如：

```bash
python -m http.server 8000
```

随后访问 `http://localhost:8000/`。

## 文件说明

```text
.
├── index.html                      # 静态 UI 原型，无需构建
├── login.html                      # 登录页面
├── register.html                   # 注册页面
├── mfa.html                        # MFA 两步验证页面
└── assets/
    ├── auth.css                    # 三个认证页面的共享样式
    ├── auth-mountain-peach.png     # 暮山蓝与晚桃粉认证背景
    └── itemlife-atmosphere.png     # 雾紫燕麦色主页背景
```

## 当前边界

本分支暂不包含登录、路由、表单提交、接口请求和数据持久化。页面中的数据和控件仅用于展示 UI 设计，后续确认视觉方案后再同步到 `beta-czw` 的 Vue 前端。

完整产品设计说明见 [`docs/design-report.html`](./docs/design-report.html)。
