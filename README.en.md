# Fund Estimation System

<p align="right">
  <strong>English</strong> | <a href="./README.zh-CN.md">简体中文</a>
</p>

A local real-time fund estimation system with adaptive Web + Mobile UI.

## Overview

This project restores same-day fund estimation workflows for users after many platforms removed that feature. It is designed for local single-user usage with fast setup.

> Disclaimer: This project is for informational/demo use only and is **not** investment advice.

## Features

- Real-time refresh: 60s collection + UI update during CN market sessions.
- Watchlist: Add/remove 6-digit fund codes.
- Search & Sort: default / deltaDesc / deltaAsc.
- Grouping: CRUD groups, reorder, multi-group mapping, ungrouped view.
- Position snapshot: shares + cost per unit with market value, total PnL, daily PnL.
- History analysis: 7D / 30D / 90D / 180D / 1Y return and drawdown.
- Intraday chart: fixed trading-time X-axis, dynamic Y-axis.
- Operational UX: empty/no-result/error/stale/loading states.
- One-click launch: macOS and Windows bootstrap scripts.

## Tech Stack

- Next.js App Router + React 19 + TypeScript
- Next.js Route Handlers (Node runtime)
- SQLite (`better-sqlite3`)
- In-process collector scheduler (60s)
- EastMoney-based fund data source (compatible with AkShare source lineage)

## Quick Start (Developers)

### 1) Requirements

- Node.js 22+
- npm 10+

### 2) Install & Run

```bash
npm install
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)

### 3) Test & Build

```bash
npm test
npm run build
npm run start
```

## One-Click Start (Users)

### macOS

Double click:

- `scripts/start-mac.command`

### Windows

Double click:

- `scripts/start-windows.bat`

Bootstrap scripts will:

- install Node/npm when missing
- install dependencies
- build and launch service
- open browser at `http://localhost:3000`

## Runtime Rules

- Timezone: `Asia/Shanghai`
- Trading sessions:
  - `09:30-11:30`
  - `13:00-15:00`
- Collector interval: `60s`
- Stale threshold: `180s`
- Retry delays: `2s`, `5s`
- Retention: intraday points for `30 days`

## Environment Variables

- `DATABASE_PATH` (optional)
  - default: `./fund-valuation.db`

## API (v1)

### Funds

- `GET /api/v1/funds?query=&sortBy=&groupId=`
- `POST /api/v1/funds`
  - body: `{ "code": "161725", "groupIds": ["<groupId>"] }`
- `DELETE /api/v1/funds/{code}`
- `PUT /api/v1/funds/{code}/groups`
  - body: `{ "groupIds": ["<groupId>"] }`
- `GET /api/v1/funds/{code}/trend?date=YYYY-MM-DD`
- `GET /api/v1/funds/{code}/history?range=7D|30D|90D|180D|1Y`

### Position

- `PUT /api/v1/funds/{code}/position`
  - body: `{ "shares": 1280.5, "costPerUnit": 2.18 }`
- `DELETE /api/v1/funds/{code}/position`

### Groups

- `GET /api/v1/groups`
- `POST /api/v1/groups`
  - body: `{ "name": "半导体" }`
- `PATCH /api/v1/groups/{id}`
  - body: `{ "name": "半导体精选" }`
- `DELETE /api/v1/groups/{id}`
- `PUT /api/v1/groups/reorder`
  - body: `{ "ids": ["idA", "idB"] }`

### System

- `GET /api/v1/system/status`

## Project Structure

```text
app/
  api/v1/...                 # REST API routes
  globals.css                # Global tokens/styles
components/
  dashboard.tsx              # Main dashboard
  sparkline.tsx              # Intraday chart
  history-line-chart.tsx     # History analysis chart
lib/
  db.ts                      # SQLite schema + queries
  collector.ts               # 60s collector + retry
  provider/eastmoney.ts      # Data provider
scripts/
  start-mac.command
  start-windows.bat
  bootstrap-and-start.sh
  bootstrap-and-start.ps1
tests/
  *.test.ts                  # Unit + integration tests
fund-valuation-demo.pen      # Pencil high-fidelity design file
```

## Contributing

Please read [CONTRIBUTING.en.md](./CONTRIBUTING.en.md) before opening a PR.

## Roadmap

- [ ] Docker deployment support
- [ ] Optional SSE/WebSocket mode
- [ ] finshare extension for richer ETF/LOF data
- [ ] Multi-user auth
- [ ] Advanced portfolio analytics

## License

MIT License. See [LICENSE](./LICENSE).
