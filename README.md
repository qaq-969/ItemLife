# ItemLife UI Prototype

`beta-html-jl` 是 ItemLife 的静态界面设计分支，用于在接入业务功能前确认整体视觉方向。

## 在线查看

### [点击这里直接查看 ItemLife UI 页面](https://qaq-969.github.io/ItemLife/)

> 在线页面由 GitHub Pages 发布。直接点击仓库文件列表中的 `index.html`，GitHub 只会显示源代码，不会渲染页面。

## 当前设计

- 主色：雾霭紫 `#8877C7`
- 辅色：燕麦白 `#F0E7DB`
- 视觉：半透明毛玻璃、柔和植物投影、低饱和暖色背景
- 页面：首页看板、资产概览、月度指标、最近流水、常用物品与侧边导航
- 响应式：支持桌面、平板和手机宽度

## 本地预览

直接打开根目录的 [`index.html`](./index.html) 即可查看。

也可以在仓库目录启动任意静态文件服务器，例如：

```bash
python -m http.server 8000
```

随后访问 `http://localhost:8000/`。

## 文件说明

```text
.
├── index.html                      # 静态 UI 原型，无需构建
└── assets/
    └── itemlife-atmosphere.png     # 雾紫燕麦色背景素材
```

## 当前边界

本分支暂不包含登录、路由、表单提交、接口请求和数据持久化。页面中的数据和控件仅用于展示 UI 设计，后续确认视觉方案后再同步到 `beta-czw` 的 Vue 前端。

完整产品设计说明见 [`docs/design-report.html`](./docs/design-report.html)。
