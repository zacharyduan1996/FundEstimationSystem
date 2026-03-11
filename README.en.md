# Fund Estimation System

<p align="right">
  <strong>English</strong> | <a href="./README.zh-CN.md">简体中文</a>
</p>

A local real-time fund estimation system with adaptive Web + Mobile UI. It provides 60-second refresh during trading sessions, grouping, position snapshots, and history analysis.

> Disclaimer: This project is for informational/demo use only and is **not** investment advice.

## UI Preview

| Desktop | Mobile |
| --- | --- |
| ![Dashboard Desktop](./docs/images/dashboard-desktop.png) | ![Dashboard Mobile](./docs/images/dashboard-mobile.png) |

## How To Use

### 1) Add a Fund

- Click `+ Add Fund` in the top-right corner
- Enter a 6-digit fund code (optional local note)
- Optionally assign groups during creation

![Add Fund Dialog](./docs/images/add-fund-dialog.png)

### 2) Manage Groups

- Click `Manage Groups`
- Create, rename, delete, and reorder groups
- Use `Edit Groups` on each card for multi-group assignment

![Group Manage Dialog](./docs/images/group-manage-dialog.png)

### 3) Edit Position

- Click `Edit Position` on a card (or `Add Position` if empty)
- Input `Shares` and `Cost Per Unit`
- Save to compute market value, total PnL, and daily PnL

![Position Dialog](./docs/images/position-dialog.png)

### 4) History Analysis

- Expand `History Analysis` at the bottom of a card
- Switch ranges: `7D / 30D / 90D / 180D / 1Y`
- Check return, max drawdown, high/low points

![History Panel](./docs/images/history-panel.png)

### 5) Intraday Notes + Review Workspace

- Use the right sidebar for real-time intraday notes (press Enter to save quickly)
- Click `Open Review` to enter the dual-pane review workspace (history titles on left, editor on right)
- Supports title search, date-grouped browsing, and `Cmd/Ctrl+S` quick save

### 6) Intraday Workspace Shortcuts

- The main area uses a 3-column fund-card grid so you can scan more funds at once
- Keyboard support: `↑/↓/←/→` switch focused fund, `/` focus search, `n` focus note input
- Review modal shortcuts: `Esc` close, `↑/↓` switch notes, `Cmd/Ctrl+S` save

### 7) Search, Sort, and Privacy

- Search by code (Enter to query immediately)
- Sort by default / gain first / loss first
- Toggle amount privacy from the header

## Features

- Real-time refresh every 60s in CN trading sessions
- Add/remove watchlist funds by 6-digit code
- Group CRUD, reorder, multi-group mapping, ungrouped view
- Position snapshot with value and PnL metrics
- Multi-range historical NAV analysis
- Intraday workspace: 3-column main cards + right real-time note sidebar
- Notes workflow: intraday quick notes + dual-pane review workspace
- Empty/no-result/error/stale/loading state handling
- One-click bootstrap for macOS and Windows

## Quick Start (Developers)

### Requirements

- Node.js 22+
- npm 10+

### Install & Run

```bash
npm install
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)

### Test & Build

```bash
npm run verify
```

`verify` runs: lint + typecheck + test + build.

## One-Click Start (Users)

### macOS

Double click: `scripts/start-mac.command`

### Windows

Double click: `scripts/start-windows.bat`

Scripts automatically:

- install Node/npm if missing
- install dependencies
- build and launch service
- open browser at `http://localhost:3000`

## Runtime Rules

- Timezone: `Asia/Shanghai`
- Trading sessions: `09:30-11:30`, `13:00-15:00`
- Collector interval: `60s`
- Stale threshold: `180s`
- Retry delays: `2s`, `5s`
- Data retention: `30 days` for intraday points

## Engineering Standards

- Default development branch: `develop` (`main` is for stable releases only)
- Create feature branches from `develop` and merge PRs back into `develop`
- Run `npm run verify` before commit/PR
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)
- Full standards: `docs/engineering-standards.md`
- Agent constraints: `AGENTS.md`

## Environment Variable

- `DATABASE_PATH` (optional)
  - default: `./fund-valuation.db`

## API (v1)

### Funds

- `GET /api/v1/funds?query=&sortBy=&groupId=`
- `POST /api/v1/funds`
- `DELETE /api/v1/funds/{code}`
- `PUT /api/v1/funds/{code}/groups`
- `GET /api/v1/funds/{code}/checklist`
- `POST /api/v1/funds/{code}/checklist`
- `PUT /api/v1/funds/{code}/checklist/{id}`
- `DELETE /api/v1/funds/{code}/checklist/{id}`
- `GET /api/v1/funds/{code}/reviews`
- `POST /api/v1/funds/{code}/reviews` (`title` is required)
- `PUT /api/v1/funds/{code}/reviews/{id}` (supports updating `title`)
- `DELETE /api/v1/funds/{code}/reviews/{id}`
- `GET /api/v1/funds/{code}/trend?date=YYYY-MM-DD`
- `GET /api/v1/funds/{code}/history?range=7D|30D|90D|180D|1Y`

### Position

- `PUT /api/v1/funds/{code}/position`
- `DELETE /api/v1/funds/{code}/position`

### Groups

- `GET /api/v1/groups`
- `POST /api/v1/groups`
- `PATCH /api/v1/groups/{id}`
- `DELETE /api/v1/groups/{id}`
- `PUT /api/v1/groups/reorder`

### Batch

- `PUT /api/v1/funds/batch/groups`
- `DELETE /api/v1/funds/batch`

### System

- `GET /api/v1/system/status`

## Tech Stack

- Next.js App Router + React 19 + TypeScript
- Next.js Route Handlers (Node runtime)
- SQLite (`better-sqlite3`)
- In-process 60-second collector
- EastMoney-based provider (same source lineage as AkShare endpoint)

## Contributing

Please read [CONTRIBUTING.en.md](./CONTRIBUTING.en.md).

## License

MIT License. See [LICENSE](./LICENSE).
