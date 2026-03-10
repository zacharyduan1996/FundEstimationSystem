# Fund Valuation Demo (Next.js)

基于 Next.js 的本地基金当日估值 Demo，支持：

- 60 秒自动刷新（交易时段）
- 添加/删除基金代码
- 手动分组与多分组归属（全部/分组/未分组标签）
- 搜索与排序
- 日内估值曲线（实时累积点）
- 交易日历判定（周末 + 中国法定节假日）
- ETF/LOF 优先分钟线来源（V1.1 增强）
- Web + Mobile 自适应界面

## 技术栈

- Next.js App Router
- SQLite (`better-sqlite3`)
- 定时采集（服务端 interval）
- 数据源：东方财富基金估值接口（与 AkShare `fund_value_estimation_em` 同源）
- ETF/LOF 分钟线：东方财富 `trends2` 行情接口（兼容 finshare 的 EastMoney 思路）

## 运行

```bash
npm install
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)

## API

- `GET /api/v1/funds?query=&sortBy=`
- `POST /api/v1/funds` body: `{ "code": "161725", "groupIds": ["<groupId>"] }`
- `DELETE /api/v1/funds/{code}`
- `PUT /api/v1/funds/{code}/groups` body: `{ "groupIds": ["<groupId>"] }`
- `GET /api/v1/funds/{code}/trend?date=YYYY-MM-DD`
- `GET /api/v1/system/status`
- `GET /api/v1/groups`
- `POST /api/v1/groups` body: `{ "name": "半导体" }`
- `PATCH /api/v1/groups/{id}` body: `{ "name": "半导体精选" }`
- `DELETE /api/v1/groups/{id}`
- `PUT /api/v1/groups/reorder` body: `{ "ids": ["idA", "idB"] }`

## 环境变量

- `DATABASE_PATH`（可选）：SQLite 文件路径，默认 `./fund-valuation.db`

## 测试

```bash
npm test
```

## 移机一键安装与启动

### 最傻瓜式（双击即可）

- macOS：双击 `scripts/start-mac.command`
- Windows：双击 `scripts/start-windows.bat`

这两个入口会自动调用安装脚本，完成依赖安装、构建、后台启动，并尝试自动打开浏览器。

内置容错策略（默认开启）：
- 优先复用机器已有 `node/npm`（有就不重装）
- macOS 优先走 Node pkg 快速安装（避免 Homebrew 编译链）
- 若包管理器失败或不可用，自动回退到项目内便携 Node 运行时（`.runtime/node`）
- npm 安装默认使用国内镜像 `https://registry.npmmirror.com`
- `FAST_START=on` 时，如果服务已运行/依赖未变化/构建未变化，将自动跳过重装与重建，秒级启动

### Linux / macOS

脚本：`/Users/raymondj/Documents/Raymond/personal/financial/scripts/bootstrap-and-start.sh`

默认行为：
- 自动安装系统依赖（Linux apt / macOS 仅在必要时 brew）
- 安装 Node.js（默认目标 22.x）
- 安装 npm 依赖并执行 `npm run build`
- Linux 优先用 `systemd` 拉起服务；其他环境回退 `nohup`

```bash
cd /Users/raymondj/Documents/Raymond/personal/financial
./scripts/bootstrap-and-start.sh --port 3000 --database-path /data/fund-valuation.db
```

### Windows (PowerShell)

脚本：`/Users/raymondj/Documents/Raymond/personal/financial/scripts/bootstrap-and-start.ps1`

默认行为：
- 自动安装 Node.js LTS（优先 `winget`，其次 `choco`）
- 若 `winget/choco` 不可用，自动安装项目内便携 Node（无需全局安装）
- 遇到 `better-sqlite3` 编译依赖缺失时自动尝试安装 Visual Studio Build Tools
- 安装 npm 依赖并执行 `npm run build`
- 后台启动服务并输出 PID/日志路径（`run/*.pid`, `logs/*.log`）

```powershell
cd C:\path\to\financial
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-and-start.ps1 -Port 3000 -DatabasePath "D:\data\fund-valuation.db"
```

常用参数：
- Linux/macOS: `--start-mode auto|systemd|nohup`, `--service-name`, `--node-major`, `--fast-start on|off`, `--skip-build`
- Linux/macOS 环境变量：`HOMEBREW_MIRROR=cn|official`, `NODE_MIRROR=cn|official`, `NPM_REGISTRY=<url>`, `FAST_START=on|off`
- Windows: `-StartMode auto|background`, `-ServiceName`, `-NodeMajor`, `-NodeMirror cn|official`, `-NpmRegistry`, `-FastStart on|off`, `-SkipBuild`
