# 基金实时估值系统（Fund Estimation System）

<p align="right">
  <a href="./README.en.md">English</a> | <strong>简体中文</strong>
</p>

一个本地运行的基金实时估值系统，支持 Web + Mobile 自适应界面，提供交易时段 60 秒级估值更新、分组管理、持仓快照与历史分析能力。

> 免责声明：本项目仅用于信息展示与演示，不构成投资建议。

## 界面预览

| 桌面端 | 移动端 |
| --- | --- |
| ![Dashboard Desktop](./docs/images/dashboard-desktop.png) | ![Dashboard Mobile](./docs/images/dashboard-mobile.png) |

## 操作说明

### 1) 添加基金

- 点击右上角 `+ 添加基金`
- 输入 6 位基金代码（可选填写本地备注）
- 可在添加时直接勾选分组

![Add Fund Dialog](./docs/images/add-fund-dialog.png)

### 2) 分组管理

- 点击 `管理分组` 打开分组面板
- 支持新建、重命名、删除、顺序调整
- 卡片的 `编辑分组` 支持多分组归属

![Group Manage Dialog](./docs/images/group-manage-dialog.png)

### 3) 持仓编辑

- 在卡片中点击 `编辑持仓`（无持仓时点击 `录入持仓`）
- 录入 `持有份额` 与 `单位持仓成本`
- 保存后自动计算持仓市值、累计盈亏、当日盈亏

![Position Dialog](./docs/images/position-dialog.png)

### 4) 历史分析

- 点击卡片底部 `历史分析` 展开
- 支持 `7D / 30D / 90D / 180D / 1Y` 切换
- 展示区间收益、最大回撤、区间高低点

![History Panel](./docs/images/history-panel.png)

### 5) 搜索、排序与隐私模式

- 搜索：输入基金代码关键词，支持回车立即查询
- 排序：默认 / 涨幅优先 / 跌幅优先
- 隐私：点击头部 `金额隐私` 可一键隐藏金额字段

## 功能特性

- 实时刷新：交易时段按 60 秒采集与更新
- 自选基金：支持添加/删除 6 位基金代码
- 分组管理：分组 CRUD、重排、多分组归属、未分组视图
- 持仓快照：录入份额 + 成本，展示市值与盈亏
- 历史分析：多区间净值分析与回撤指标
- 状态反馈：空态、无结果、错误、延迟、加载提示
- 一键启动：macOS / Windows 自动安装依赖并启动

## 快速开始（开发者）

### 环境要求

- Node.js 22+
- npm 10+

### 安装运行

```bash
npm install
npm run dev
```

访问：[http://localhost:3000](http://localhost:3000)

### 测试与构建

```bash
npm run verify
```

`verify` 会执行：lint + typecheck + test + build

## 一键启动（普通用户）

### macOS

双击：`scripts/start-mac.command`

### Windows

双击：`scripts/start-windows.bat`

脚本会自动：

- 缺失时安装 Node/npm
- 安装项目依赖
- 构建并启动服务
- 自动打开 `http://localhost:3000`

## 运行规则

- 时区：`Asia/Shanghai`
- 交易时段：`09:30-11:30`、`13:00-15:00`
- 采集间隔：`60s`
- 延迟阈值：`180s`
- 重试回退：`2s`、`5s`
- 数据保留：日内点位保留 `30 天`

## 工程化规范

- 默认开发分支：`develop`（`main` 仅用于稳定发布）
- 开发前从 `develop` 拉分支，PR 合并回 `develop`
- 提交前必须执行 `npm run verify`
- 提交信息使用 Conventional Commits（`feat:` / `fix:` / `docs:` 等）
- 详细规范见：`docs/engineering-standards.md`
- Agent 约束见：`AGENTS.md`

## 环境变量

- `DATABASE_PATH`（可选）
  - 默认：`./fund-valuation.db`

## API（v1）

### 基金

- `GET /api/v1/funds?query=&sortBy=&groupId=`
- `POST /api/v1/funds`
- `DELETE /api/v1/funds/{code}`
- `PUT /api/v1/funds/{code}/groups`
- `GET /api/v1/funds/{code}/trend?date=YYYY-MM-DD`
- `GET /api/v1/funds/{code}/history?range=7D|30D|90D|180D|1Y`

### 持仓

- `PUT /api/v1/funds/{code}/position`
- `DELETE /api/v1/funds/{code}/position`

### 分组

- `GET /api/v1/groups`
- `POST /api/v1/groups`
- `PATCH /api/v1/groups/{id}`
- `DELETE /api/v1/groups/{id}`
- `PUT /api/v1/groups/reorder`

### 系统

- `GET /api/v1/system/status`

## 技术栈

- Next.js App Router + React 19 + TypeScript
- Next.js Route Handlers（Node runtime）
- SQLite（`better-sqlite3`）
- 进程内定时采集（60s）
- 东方财富数据源（与 AkShare 同源链路）

## 贡献

请先阅读 [CONTRIBUTING.zh-CN.md](./CONTRIBUTING.zh-CN.md)。

## 许可证

MIT License，详见 [LICENSE](./LICENSE)。
