# 基金实时估值系统（Fund Estimation System）

<p align="right">
  <a href="./README.en.md">English</a> | <strong>简体中文</strong>
</p>

一个本地运行的基金实时估值系统，支持 Web + Mobile 自适应界面。

## 项目简介

本项目用于在基金平台下线“当日估值”后，为用户提供本地实时估值参考，默认面向单用户本地部署。

> 免责声明：本项目仅用于信息展示与演示，不构成投资建议。

## 功能特性

- 实时刷新：交易时段按 60 秒采集与更新
- 自选基金：支持添加/删除 6 位基金代码
- 搜索与排序：默认 / 涨幅优先 / 跌幅优先
- 分组管理：分组 CRUD、重排、多分组归属、未分组视图
- 持仓快照：录入份额 + 成本，展示市值、累计盈亏、当日盈亏
- 历史分析：7D / 30D / 90D / 180D / 1Y 区间收益与回撤
- 日内曲线：固定交易时间坐标轴、动态 Y 轴
- 状态反馈：空态、无结果、错误、延迟、加载提示
- 一键启动：macOS / Windows 自动安装依赖并启动

## 技术栈

- Next.js App Router + React 19 + TypeScript
- Next.js Route Handlers（Node runtime）
- SQLite（`better-sqlite3`）
- 进程内定时采集（60s）
- 东方财富数据源（与 AkShare 同源链路）

## 开发者快速开始

### 1）环境要求

- Node.js 22+
- npm 10+

### 2）安装并运行

```bash
npm install
npm run dev
```

访问：[http://localhost:3000](http://localhost:3000)

### 3）测试与构建

```bash
npm test
npm run build
npm run start
```

## 普通用户一键启动

### macOS

双击：

- `scripts/start-mac.command`

### Windows

双击：

- `scripts/start-windows.bat`

脚本会自动：

- 缺失时安装 Node/npm
- 安装项目依赖
- 构建并启动服务
- 自动打开 `http://localhost:3000`

## 运行规则

- 时区：`Asia/Shanghai`
- 交易时段：
  - `09:30-11:30`
  - `13:00-15:00`
- 采集间隔：`60s`
- 延迟阈值：`180s`
- 失败重试：`2s`、`5s`
- 数据保留：日内点位保留 `30 天`

## 环境变量

- `DATABASE_PATH`（可选）
  - 默认：`./fund-valuation.db`

## API（v1）

### 基金

- `GET /api/v1/funds?query=&sortBy=&groupId=`
- `POST /api/v1/funds`
  - body: `{ "code": "161725", "groupIds": ["<groupId>"] }`
- `DELETE /api/v1/funds/{code}`
- `PUT /api/v1/funds/{code}/groups`
  - body: `{ "groupIds": ["<groupId>"] }`
- `GET /api/v1/funds/{code}/trend?date=YYYY-MM-DD`
- `GET /api/v1/funds/{code}/history?range=7D|30D|90D|180D|1Y`

### 持仓

- `PUT /api/v1/funds/{code}/position`
  - body: `{ "shares": 1280.5, "costPerUnit": 2.18 }`
- `DELETE /api/v1/funds/{code}/position`

### 分组

- `GET /api/v1/groups`
- `POST /api/v1/groups`
  - body: `{ "name": "半导体" }`
- `PATCH /api/v1/groups/{id}`
  - body: `{ "name": "半导体精选" }`
- `DELETE /api/v1/groups/{id}`
- `PUT /api/v1/groups/reorder`
  - body: `{ "ids": ["idA", "idB"] }`

### 系统

- `GET /api/v1/system/status`

## 项目结构

```text
app/
  api/v1/...                 # REST API routes
  globals.css                # 全局样式与设计 token
components/
  dashboard.tsx              # 主页面
  sparkline.tsx              # 日内曲线
  history-line-chart.tsx     # 历史分析曲线
lib/
  db.ts                      # SQLite schema + 查询
  collector.ts               # 60s 采集 + 重试
  provider/eastmoney.ts      # 数据源适配
scripts/
  start-mac.command
  start-windows.bat
  bootstrap-and-start.sh
  bootstrap-and-start.ps1
tests/
  *.test.ts                  # 单元与集成测试
fund-valuation-demo.pen      # Pencil 高保真设计稿
```

## 贡献

请在提交 PR 前阅读 [CONTRIBUTING.zh-CN.md](./CONTRIBUTING.zh-CN.md)。

## 路线图

- [ ] 支持 Docker 部署
- [ ] 可选 SSE/WebSocket 推送
- [ ] 集成 finshare 增强 ETF/LOF 分钟数据
- [ ] 多用户权限体系
- [ ] 更完整的持仓分析能力

## 许可证

MIT License，详见 [LICENSE](./LICENSE)。
