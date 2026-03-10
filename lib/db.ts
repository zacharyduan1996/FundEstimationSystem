import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { detectFundInstrumentType } from "./fund-kind";
import { getTodayShanghai } from "./time";
import { isStale } from "./trading";
import type {
  FundGroup,
  FundGroupMembership,
  FundCardData,
  GroupFilter,
  GroupTabStat,
  HistoryPoint,
  FundInstrumentType,
  FundQuoteSource,
  PositionMetrics,
  PositionSnapshot,
  SortBy,
  SystemStatus,
  TrendPoint,
  WatchlistItem
} from "./types";

type BetterSqliteDatabase = Database.Database;

let singletonDb: BetterSqliteDatabase | null = null;

function resolveDatabasePath(): string {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }

  return `${process.cwd()}/fund-valuation.db`;
}

function openDatabase(filePath: string): BetterSqliteDatabase {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      code TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS intraday_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      nav REAL NOT NULL,
      estimated_nav REAL NOT NULL,
      delta_value REAL NOT NULL,
      delta_percent REAL NOT NULL,
      quote_ts TEXT NOT NULL,
      as_of_date TEXT NOT NULL,
      as_of_time TEXT NOT NULL,
      instrument_type TEXT NOT NULL DEFAULT 'open_fund',
      source TEXT NOT NULL DEFAULT 'eastmoney_estimation',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(code, quote_ts)
    );

    CREATE INDEX IF NOT EXISTS idx_intraday_code_date ON intraday_points(code, as_of_date, quote_ts);

    CREATE TABLE IF NOT EXISTS position_snapshots (
      code TEXT PRIMARY KEY,
      shares REAL NOT NULL,
      cost_per_unit REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (code) REFERENCES watchlist(code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fund_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fund_group_memberships (
      code TEXT NOT NULL,
      group_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (code, group_id),
      FOREIGN KEY (code) REFERENCES watchlist(code) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES fund_groups(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_group_memberships_group ON fund_group_memberships(group_id, code);

    CREATE TABLE IF NOT EXISTS collector_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      last_run_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      source_healthy INTEGER NOT NULL DEFAULT 1,
      is_trading_time INTEGER NOT NULL DEFAULT 0
    );

    INSERT INTO collector_state (id)
    VALUES (1)
    ON CONFLICT(id) DO NOTHING;
  `);

  const columns = db.prepare("PRAGMA table_info(intraday_points)").all() as Array<{ name: string }>;
  const hasInstrumentType = columns.some((column) => column.name === "instrument_type");
  const hasSource = columns.some((column) => column.name === "source");

  if (!hasInstrumentType) {
    db.exec("ALTER TABLE intraday_points ADD COLUMN instrument_type TEXT NOT NULL DEFAULT 'open_fund'");
  }

  if (!hasSource) {
    db.exec("ALTER TABLE intraday_points ADD COLUMN source TEXT NOT NULL DEFAULT 'eastmoney_estimation'");
  }

  return db;
}

export function getDb(): BetterSqliteDatabase {
  if (!singletonDb) {
    singletonDb = openDatabase(resolveDatabasePath());
  }

  return singletonDb;
}

export function createIsolatedDb(filePath: string): BetterSqliteDatabase {
  return openDatabase(filePath);
}

export function listWatchlist(db = getDb()): WatchlistItem[] {
  return db
    .prepare("SELECT code, created_at AS createdAt FROM watchlist ORDER BY created_at DESC")
    .all() as WatchlistItem[];
}

export function hasWatchlistItem(code: string, db = getDb()): boolean {
  const row = db.prepare("SELECT 1 as ok FROM watchlist WHERE code = ? LIMIT 1").get(code) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

export function addWatchlistItem(code: string, db = getDb()): WatchlistItem {
  db.prepare("INSERT INTO watchlist (code) VALUES (?) ON CONFLICT(code) DO NOTHING").run(code);
  return db.prepare("SELECT code, created_at AS createdAt FROM watchlist WHERE code = ?").get(code) as WatchlistItem;
}

export function addWatchlistItemWithStatus(
  code: string,
  db = getDb()
): { item: WatchlistItem; created: boolean } {
  const result = db.prepare("INSERT INTO watchlist (code) VALUES (?) ON CONFLICT(code) DO NOTHING").run(code);
  const item = db.prepare("SELECT code, created_at AS createdAt FROM watchlist WHERE code = ?").get(code) as WatchlistItem;
  return { item, created: result.changes > 0 };
}

export function deleteWatchlistItem(code: string, db = getDb()): boolean {
  const result = db.prepare("DELETE FROM watchlist WHERE code = ?").run(code);
  return result.changes > 0;
}

export class GroupNameConflictError extends Error {
  constructor() {
    super("分组名称已存在");
    this.name = "GroupNameConflictError";
  }
}

export class GroupLimitExceededError extends Error {
  constructor(limit: number) {
    super(`分组数量不能超过 ${limit} 个`);
    this.name = "GroupLimitExceededError";
  }
}

export class GroupNotFoundError extends Error {
  constructor() {
    super("分组不存在");
    this.name = "GroupNotFoundError";
  }
}

const MAX_GROUPS = 20;
const RESERVED_GROUP_FILTERS = new Set(["all", "ungrouped"]);

function normalizeGroupName(name: string): string {
  return name.trim();
}

function assertValidGroupName(name: string): string {
  const normalized = normalizeGroupName(name);
  if (normalized.length === 0) {
    throw new Error("分组名称不能为空");
  }
  if (normalized.length > 20) {
    throw new Error("分组名称不能超过 20 个字符");
  }
  return normalized;
}

function assertCanUseAsGroupId(groupId: string): void {
  if (RESERVED_GROUP_FILTERS.has(groupId)) {
    throw new Error("分组 ID 不可使用保留关键字");
  }
}

export function listFundGroups(db = getDb()): FundGroup[] {
  return db
    .prepare(
      `
      SELECT
        g.id AS id,
        g.name AS name,
        g.sort_order AS sortOrder,
        COUNT(m.code) AS fundCount
      FROM fund_groups g
      LEFT JOIN fund_group_memberships m ON m.group_id = g.id
      GROUP BY g.id
      ORDER BY g.sort_order ASC, g.created_at ASC
    `
    )
    .all() as FundGroup[];
}

export function hasFundGroup(groupId: string, db = getDb()): boolean {
  const row = db.prepare("SELECT 1 AS ok FROM fund_groups WHERE id = ? LIMIT 1").get(groupId) as
    | { ok: number }
    | undefined;
  return Boolean(row?.ok);
}

export function createFundGroup(name: string, db = getDb()): FundGroup {
  const normalizedName = assertValidGroupName(name);
  const groupCountRow = db
    .prepare("SELECT COUNT(*) AS count FROM fund_groups")
    .get() as { count: number };
  if (groupCountRow.count >= MAX_GROUPS) {
    throw new GroupLimitExceededError(MAX_GROUPS);
  }

  const now = new Date().toISOString();
  const maxOrderRow = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM fund_groups")
    .get() as { maxOrder: number };
  const nextOrder = maxOrderRow.maxOrder + 1;

  const id = randomUUID();
  try {
    db.prepare(
      `
      INSERT INTO fund_groups (id, name, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      `
    ).run(id, normalizedName, nextOrder, now, now);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: fund_groups.name/i.test(error.message)) {
      throw new GroupNameConflictError();
    }
    throw error;
  }

  return db
    .prepare(
      `
      SELECT id, name, sort_order AS sortOrder, 0 AS fundCount
      FROM fund_groups
      WHERE id = ?
    `
    )
    .get(id) as FundGroup;
}

export function renameFundGroup(groupId: string, name: string, db = getDb()): FundGroup {
  assertCanUseAsGroupId(groupId);
  const normalizedName = assertValidGroupName(name);
  const now = new Date().toISOString();

  try {
    const result = db
      .prepare("UPDATE fund_groups SET name = ?, updated_at = ? WHERE id = ?")
      .run(normalizedName, now, groupId);
    if (result.changes === 0) {
      throw new GroupNotFoundError();
    }
  } catch (error) {
    if (error instanceof GroupNotFoundError) {
      throw error;
    }
    if (error instanceof Error && /UNIQUE constraint failed: fund_groups.name/i.test(error.message)) {
      throw new GroupNameConflictError();
    }
    throw error;
  }

  return db
    .prepare(
      `
      SELECT
        g.id AS id,
        g.name AS name,
        g.sort_order AS sortOrder,
        COUNT(m.code) AS fundCount
      FROM fund_groups g
      LEFT JOIN fund_group_memberships m ON m.group_id = g.id
      WHERE g.id = ?
      GROUP BY g.id
    `
    )
    .get(groupId) as FundGroup;
}

export function deleteFundGroup(groupId: string, db = getDb()): boolean {
  assertCanUseAsGroupId(groupId);
  const tx = db.transaction((id: string) => {
    const target = db
      .prepare("SELECT id, sort_order AS sortOrder FROM fund_groups WHERE id = ?")
      .get(id) as { id: string; sortOrder: number } | undefined;
    if (!target) {
      return false;
    }

    db.prepare("DELETE FROM fund_groups WHERE id = ?").run(id);
    db.prepare("UPDATE fund_groups SET sort_order = sort_order - 1 WHERE sort_order > ?").run(target.sortOrder);
    return true;
  });
  return tx(groupId);
}

export function reorderFundGroups(groupIds: string[], db = getDb()): FundGroup[] {
  const deduped = [...new Set(groupIds)];
  deduped.forEach(assertCanUseAsGroupId);

  const existing = listFundGroups(db);
  if (existing.length !== deduped.length) {
    throw new Error("分组重排参数不完整");
  }

  const existingSet = new Set(existing.map((group) => group.id));
  for (const id of deduped) {
    if (!existingSet.has(id)) {
      throw new GroupNotFoundError();
    }
  }

  const now = new Date().toISOString();
  const tx = db.transaction((ids: string[]) => {
    ids.forEach((id, index) => {
      db.prepare("UPDATE fund_groups SET sort_order = ?, updated_at = ? WHERE id = ?").run(index, now, id);
    });
  });
  tx(deduped);
  return listFundGroups(db);
}

export function setFundGroupsForCode(code: string, groupIds: string[], db = getDb()): FundGroupMembership[] {
  if (!hasWatchlistItem(code, db)) {
    throw new Error("该基金不在自选列表中");
  }

  const deduped = [...new Set(groupIds)];
  deduped.forEach(assertCanUseAsGroupId);

  if (deduped.length > 0) {
    const placeholders = deduped.map(() => "?").join(",");
    const row = db
      .prepare(`SELECT COUNT(*) AS count FROM fund_groups WHERE id IN (${placeholders})`)
      .get(...deduped) as { count: number };
    if (row.count !== deduped.length) {
      throw new GroupNotFoundError();
    }
  }

  const tx = db.transaction((ids: string[]) => {
    db.prepare("DELETE FROM fund_group_memberships WHERE code = ?").run(code);
    const insert = db.prepare(
      "INSERT INTO fund_group_memberships (code, group_id, created_at) VALUES (?, ?, ?)"
    );
    const now = new Date().toISOString();
    ids.forEach((groupId) => {
      insert.run(code, groupId, now);
    });
  });
  tx(deduped);

  return listFundGroupMembershipsForCodes([code], db)[code] ?? [];
}

function listFundGroupMembershipsForCodes(
  codes: string[],
  db = getDb()
): Record<string, FundGroupMembership[]> {
  if (codes.length === 0) {
    return {};
  }

  const placeholders = codes.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT
        m.code AS code,
        g.id AS groupId,
        g.name AS groupName,
        g.sort_order AS sortOrder
      FROM fund_group_memberships m
      INNER JOIN fund_groups g ON g.id = m.group_id
      WHERE m.code IN (${placeholders})
      ORDER BY g.sort_order ASC, g.created_at ASC
      `
    )
    .all(...codes) as Array<{
    code: string;
    groupId: string;
    groupName: string;
    sortOrder: number;
  }>;

  const grouped: Record<string, FundGroupMembership[]> = {};
  for (const row of rows) {
    if (!grouped[row.code]) {
      grouped[row.code] = [];
    }
    grouped[row.code].push({
      groupId: row.groupId,
      groupName: row.groupName
    });
  }
  return grouped;
}

export function listGroupTabs(db = getDb()): GroupTabStat[] {
  const totalsRow = db
    .prepare(
      `
      WITH latest AS (
        SELECT ip.code AS code, ip.delta_percent AS deltaPercent
        FROM intraday_points ip
        INNER JOIN (
          SELECT code, MAX(quote_ts) AS maxTs
          FROM intraday_points
          GROUP BY code
        ) latest_ts ON latest_ts.code = ip.code AND latest_ts.maxTs = ip.quote_ts
      )
      SELECT
        COUNT(w.code) AS fundCount,
        AVG(latest.deltaPercent) AS avgDeltaPercent
      FROM watchlist w
      LEFT JOIN latest ON latest.code = w.code
      `
    )
    .get() as { fundCount: number; avgDeltaPercent: number | null };

  const manualRows = db
    .prepare(
      `
      WITH latest AS (
        SELECT ip.code AS code, ip.delta_percent AS deltaPercent
        FROM intraday_points ip
        INNER JOIN (
          SELECT code, MAX(quote_ts) AS maxTs
          FROM intraday_points
          GROUP BY code
        ) latest_ts ON latest_ts.code = ip.code AND latest_ts.maxTs = ip.quote_ts
      )
      SELECT
        g.id AS id,
        g.name AS name,
        g.sort_order AS sortOrder,
        COUNT(m.code) AS fundCount,
        AVG(latest.deltaPercent) AS avgDeltaPercent
      FROM fund_groups g
      LEFT JOIN fund_group_memberships m ON m.group_id = g.id
      LEFT JOIN latest ON latest.code = m.code
      GROUP BY g.id
      ORDER BY g.sort_order ASC, g.created_at ASC
      `
    )
    .all() as Array<{
    id: string;
    name: string;
    sortOrder: number;
    fundCount: number;
    avgDeltaPercent: number | null;
  }>;

  const ungroupedRow = db
    .prepare(
      `
      WITH latest AS (
        SELECT ip.code AS code, ip.delta_percent AS deltaPercent
        FROM intraday_points ip
        INNER JOIN (
          SELECT code, MAX(quote_ts) AS maxTs
          FROM intraday_points
          GROUP BY code
        ) latest_ts ON latest_ts.code = ip.code AND latest_ts.maxTs = ip.quote_ts
      )
      SELECT
        COUNT(w.code) AS fundCount,
        AVG(latest.deltaPercent) AS avgDeltaPercent
      FROM watchlist w
      LEFT JOIN latest ON latest.code = w.code
      WHERE NOT EXISTS (
        SELECT 1
        FROM fund_group_memberships m
        WHERE m.code = w.code
      )
      `
    )
    .get() as { fundCount: number; avgDeltaPercent: number | null };

  return [
    {
      id: "all",
      name: "全部",
      fundCount: totalsRow.fundCount,
      avgDeltaPercent: totalsRow.avgDeltaPercent,
      kind: "all"
    },
    ...manualRows.map(
      (row): GroupTabStat => ({
        id: row.id,
        name: row.name,
        fundCount: row.fundCount,
        avgDeltaPercent: row.avgDeltaPercent,
        kind: "manual"
      })
    ),
    {
      id: "ungrouped",
      name: "未分组",
      fundCount: ungroupedRow.fundCount,
      avgDeltaPercent: ungroupedRow.avgDeltaPercent,
      kind: "ungrouped"
    }
  ];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeDecimal(value: number, precision = 6): number {
  return Number(value.toFixed(precision));
}

function buildPositionMetrics(
  shares: number | null,
  costPerUnit: number | null,
  estimatedNav: number | null,
  nav: number | null
): PositionMetrics {
  if (shares === null || costPerUnit === null || shares <= 0 || costPerUnit <= 0) {
    return {
      costTotal: null,
      marketValue: null,
      totalPnl: null,
      totalPnlPct: null,
      dailyPnl: null,
      hasPosition: false
    };
  }

  const costTotal = normalizeDecimal(shares * costPerUnit);
  const marketValue = estimatedNav === null ? null : normalizeDecimal(shares * estimatedNav);
  const totalPnl = marketValue === null ? null : marketValue - costTotal;
  const totalPnlPct = totalPnl === null || costTotal <= 0 ? null : (totalPnl / costTotal) * 100;
  const dailyPnl =
    estimatedNav === null || nav === null ? null : normalizeDecimal(shares * (estimatedNav - nav));

  return {
    costTotal: round2(costTotal),
    marketValue: marketValue === null ? null : round2(marketValue),
    totalPnl: totalPnl === null ? null : round2(totalPnl),
    totalPnlPct: totalPnlPct === null ? null : round2(totalPnlPct),
    dailyPnl: dailyPnl === null ? null : round2(dailyPnl),
    hasPosition: true
  };
}

export function upsertPositionSnapshot(
  input: {
    code: string;
    shares: number;
    costPerUnit: number;
    updatedAt?: string;
  },
  db = getDb()
): PositionSnapshot {
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  db.prepare(
    `
      INSERT INTO position_snapshots (code, shares, cost_per_unit, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        shares = excluded.shares,
        cost_per_unit = excluded.cost_per_unit,
        updated_at = excluded.updated_at
    `
  ).run(input.code, input.shares, input.costPerUnit, updatedAt);

  return db
    .prepare(
      `
      SELECT code, shares, cost_per_unit AS costPerUnit, updated_at AS updatedAt
      FROM position_snapshots
      WHERE code = ?
    `
    )
    .get(input.code) as PositionSnapshot;
}

export function deletePositionSnapshot(code: string, db = getDb()): boolean {
  const result = db.prepare("DELETE FROM position_snapshots WHERE code = ?").run(code);
  return result.changes > 0;
}

export function insertIntradayPoint(
  input: {
    code: string;
    name: string;
    nav: number;
    estimatedNav: number;
    deltaPercent: number;
    quoteTs: string;
    asOfDate: string;
    asOfTime: string;
    instrumentType: FundInstrumentType;
    source: FundQuoteSource;
  },
  db = getDb()
): void {
  const deltaValue = Number((input.estimatedNav - input.nav).toFixed(4));
  db.prepare(
    `
    INSERT INTO intraday_points (
      code, name, nav, estimated_nav, delta_value, delta_percent, quote_ts, as_of_date, as_of_time, instrument_type, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code, quote_ts) DO UPDATE SET
      name = excluded.name,
      nav = excluded.nav,
      estimated_nav = excluded.estimated_nav,
      delta_value = excluded.delta_value,
      delta_percent = excluded.delta_percent,
      as_of_date = excluded.as_of_date,
      as_of_time = excluded.as_of_time,
      instrument_type = excluded.instrument_type,
      source = excluded.source
  `
  ).run(
    input.code,
    input.name,
    input.nav,
    input.estimatedNav,
    deltaValue,
    input.deltaPercent,
    input.quoteTs,
    input.asOfDate,
    input.asOfTime,
    input.instrumentType,
    input.source
  );
}

export function cleanupOldPoints(days: number, db = getDb()): number {
  const result = db
    .prepare("DELETE FROM intraday_points WHERE julianday(quote_ts) < julianday('now', ?)")
    .run(`-${days} days`);
  return result.changes;
}

function buildSortClause(sortBy: SortBy): string {
  if (sortBy === "deltaDesc") {
    return "ORDER BY COALESCE(latest.delta_percent, -9999) DESC, watchlist.created_at DESC";
  }

  if (sortBy === "deltaAsc") {
    return "ORDER BY COALESCE(latest.delta_percent, 9999) ASC, watchlist.created_at DESC";
  }

  return "ORDER BY watchlist.created_at DESC";
}

function buildGroupFilterClause(groupFilter: GroupFilter): { clause: string; params: unknown[] } {
  if (!groupFilter || groupFilter === "all") {
    return { clause: "", params: [] };
  }

  if (groupFilter === "ungrouped") {
    return {
      clause: `
      AND NOT EXISTS (
        SELECT 1
        FROM fund_group_memberships m_filter
        WHERE m_filter.code = watchlist.code
      )`,
      params: []
    };
  }

  return {
    clause: `
      AND EXISTS (
        SELECT 1
        FROM fund_group_memberships m_filter
        WHERE m_filter.code = watchlist.code
          AND m_filter.group_id = ?
      )`,
    params: [groupFilter]
  };
}

function fetchTrendForCode(code: string, date: string, db = getDb()): TrendPoint[] {
  const rows = db
    .prepare(
      `
      SELECT quote_ts as ts, estimated_nav as estimatedNav, delta_percent as deltaPercent
      FROM intraday_points
      WHERE code = ? AND as_of_date = ?
      ORDER BY quote_ts ASC
    `
    )
    .all(code, date) as TrendPoint[];

  return rows;
}

export function listFundCards(
  params: { query?: string; sortBy?: SortBy; date?: string; groupFilter?: GroupFilter },
  db = getDb()
): FundCardData[] {
  const query = (params.query ?? "").trim();
  const sortBy = params.sortBy ?? "default";
  const date = params.date ?? getTodayShanghai();
  const groupFilter = params.groupFilter ?? "all";

  const queryLike = `%${query}%`;
  const sortClause = buildSortClause(sortBy);
  const groupFilterClause = buildGroupFilterClause(groupFilter);

  const rows = db
    .prepare(
      `
      SELECT
        watchlist.code as code,
        latest.name as name,
        latest.nav as nav,
        latest.estimated_nav as estimatedNav,
        latest.delta_value as deltaValue,
        latest.delta_percent as deltaPercent,
        latest.as_of_date as asOfDate,
        latest.as_of_time as asOfTime,
        latest.quote_ts as quoteTs,
        latest.instrument_type as instrumentType,
        latest.source as source,
        position.shares as positionShares,
        position.cost_per_unit as positionCostPerUnit,
        position.updated_at as positionUpdatedAt
      FROM watchlist
      LEFT JOIN intraday_points latest
        ON latest.code = watchlist.code
        AND latest.quote_ts = (
          SELECT MAX(ip.quote_ts)
          FROM intraday_points ip
          WHERE ip.code = watchlist.code
        )
      LEFT JOIN position_snapshots position
        ON position.code = watchlist.code
      WHERE (? = '' OR watchlist.code LIKE ? OR COALESCE(latest.name, '') LIKE ?)
      ${groupFilterClause.clause}
      ${sortClause}
      `
    )
    .all(query, queryLike, queryLike, ...groupFilterClause.params) as Array<{
    code: string;
    name: string | null;
    nav: number | null;
    estimatedNav: number | null;
    deltaValue: number | null;
    deltaPercent: number | null;
    asOfDate: string | null;
    asOfTime: string | null;
    quoteTs: string | null;
    instrumentType: FundInstrumentType | null;
    source: FundQuoteSource | null;
    positionShares: number | null;
    positionCostPerUnit: number | null;
    positionUpdatedAt: string | null;
  }>;

  const membershipsByCode = listFundGroupMembershipsForCodes(
    rows.map((row) => row.code),
    db
  );

  return rows.map((row) => ({
    position:
      row.positionShares !== null && row.positionCostPerUnit !== null && row.positionUpdatedAt !== null
        ? {
            code: row.code,
            shares: row.positionShares,
            costPerUnit: row.positionCostPerUnit,
            updatedAt: row.positionUpdatedAt
          }
        : null,
    positionMetrics: buildPositionMetrics(
      row.positionShares,
      row.positionCostPerUnit,
      row.estimatedNav,
      row.nav
    ),
    code: row.code,
    name: row.name ?? "--",
    nav: row.nav,
    estimatedNav: row.estimatedNav,
    deltaValue: row.deltaValue,
    deltaPercent: row.deltaPercent,
    asOfDate: row.asOfDate,
    asOfTime: row.asOfTime,
    trendPoints: fetchTrendForCode(row.code, date, db),
    stale: isStale(row.quoteTs),
    instrumentType: row.instrumentType ?? detectFundInstrumentType(row.code),
    source: row.source ?? null,
    groups: membershipsByCode[row.code] ?? []
  }));
}

export function getTrendPoints(code: string, date: string, db = getDb()): TrendPoint[] {
  return fetchTrendForCode(code, date, db);
}

export function getHistoryPoints(
  code: string,
  startDate: string,
  endDate: string,
  db = getDb()
): HistoryPoint[] {
  return db
    .prepare(
      `
      SELECT
        latest.quote_ts AS ts,
        latest.estimated_nav AS nav,
        latest.delta_percent AS deltaPct
      FROM intraday_points latest
      INNER JOIN (
        SELECT as_of_date, MAX(quote_ts) AS max_quote_ts
        FROM intraday_points
        WHERE code = ? AND as_of_date BETWEEN ? AND ?
        GROUP BY as_of_date
      ) daily ON daily.as_of_date = latest.as_of_date
           AND daily.max_quote_ts = latest.quote_ts
      WHERE latest.code = ?
      ORDER BY latest.quote_ts ASC
    `
    )
    .all(code, startDate, endDate, code) as HistoryPoint[];
}

export function updateCollectorState(
  state: Partial<{
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
    sourceHealthy: boolean;
    isTradingTime: boolean;
  }>,
  db = getDb()
): void {
  const current = getCollectorState(db);
  const payload = {
    ...current,
    ...state,
    sourceHealthy: state.sourceHealthy ?? current.sourceHealthy,
    isTradingTime: state.isTradingTime ?? current.isTradingTime
  };

  db.prepare(
    `
    UPDATE collector_state
    SET
      last_run_at = ?,
      last_success_at = ?,
      last_error = ?,
      consecutive_failures = ?,
      source_healthy = ?,
      is_trading_time = ?
    WHERE id = 1
  `
  ).run(
    payload.lastRunAt,
    payload.lastSuccessAt,
    payload.lastError,
    payload.consecutiveFailures,
    payload.sourceHealthy ? 1 : 0,
    payload.isTradingTime ? 1 : 0
  );
}

export function getCollectorState(db = getDb()): SystemStatus {
  const row = db
    .prepare(
      `
      SELECT
        last_run_at as lastRunAt,
        last_success_at as lastSuccessAt,
        last_error as lastError,
        consecutive_failures as consecutiveFailures,
        source_healthy as sourceHealthy,
        is_trading_time as isTradingTime
      FROM collector_state
      WHERE id = 1
    `
    )
    .get() as {
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
    sourceHealthy: number;
    isTradingTime: number;
  };

  return {
    lastRunAt: row?.lastRunAt ?? null,
    lastSuccessAt: row?.lastSuccessAt ?? null,
    lastError: row?.lastError ?? null,
    consecutiveFailures: row?.consecutiveFailures ?? 0,
    sourceHealthy: Boolean(row?.sourceHealthy),
    isTradingDay: false,
    isTradingTime: Boolean(row?.isTradingTime)
  };
}

export function countIntradayPointsForCodeAndTs(code: string, ts: string, db = getDb()): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM intraday_points WHERE code = ? AND quote_ts = ?")
    .get(code, ts) as { count: number };

  return row.count;
}
