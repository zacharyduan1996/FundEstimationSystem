import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import dayjs from "dayjs";
import { detectFundInstrumentType } from "./fund-kind";
import { getTodayShanghai } from "./time";
import { isStale } from "./trading";
import type {
  DecisionChecklistItem,
  DecisionChecklistPriority,
  DecisionChecklistStatus,
  DecisionPanelSummary,
  FundReviewNote,
  FundGroup,
  FundGroupMembership,
  FundCardData,
  GroupPerformanceSummary,
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

    CREATE TABLE IF NOT EXISTS fund_review_notes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      review_date TEXT NOT NULL,
      expectation TEXT NOT NULL,
      result TEXT NOT NULL,
      reason TEXT NOT NULL,
      action_plan TEXT NOT NULL,
      record_kind TEXT NOT NULL DEFAULT 'legacy',
      source_checklist_item_id TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (code) REFERENCES watchlist(code) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_review_code_date
      ON fund_review_notes(code, review_date DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS fund_decision_checklist_items (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      trigger_condition TEXT NOT NULL,
      action_plan TEXT NOT NULL,
      invalid_condition TEXT NOT NULL,
      review_note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      archived_review_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (code) REFERENCES watchlist(code) ON DELETE CASCADE,
      FOREIGN KEY (archived_review_id) REFERENCES fund_review_notes(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_checklist_code_date
      ON fund_decision_checklist_items(code, trade_date DESC, updated_at DESC);

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

  const reviewColumns = db.prepare("PRAGMA table_info(fund_review_notes)").all() as Array<{ name: string }>;
  const hasTitle = reviewColumns.some((column) => column.name === "title");
  const hasRecordKind = reviewColumns.some((column) => column.name === "record_kind");
  const hasSourceChecklistItemId = reviewColumns.some((column) => column.name === "source_checklist_item_id");
  if (!hasTitle) {
    db.exec("ALTER TABLE fund_review_notes ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  }
  if (!hasRecordKind) {
    db.exec("ALTER TABLE fund_review_notes ADD COLUMN record_kind TEXT NOT NULL DEFAULT 'legacy'");
  }
  if (!hasSourceChecklistItemId) {
    db.exec("ALTER TABLE fund_review_notes ADD COLUMN source_checklist_item_id TEXT");
  }

  db.prepare(
    `
    UPDATE fund_review_notes
    SET title = substr(COALESCE(NULLIF(TRIM(result), ''), '历史复盘'), 1, 60)
    WHERE title IS NULL OR TRIM(title) = ''
    `
  ).run();

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

export class ReviewNoteNotFoundError extends Error {
  constructor() {
    super("复盘笔记不存在");
    this.name = "ReviewNoteNotFoundError";
  }
}

export class DecisionChecklistNotFoundError extends Error {
  constructor() {
    super("执行清单不存在");
    this.name = "DecisionChecklistNotFoundError";
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

export function setFundGroupsForCodes(
  codes: string[],
  groupIds: string[],
  db = getDb()
): { updatedCount: number } {
  const dedupedCodes = [...new Set(codes.map((code) => code.trim()).filter((code) => code.length > 0))];
  if (dedupedCodes.length === 0) {
    return { updatedCount: 0 };
  }

  const dedupedGroupIds = [...new Set(groupIds)];
  dedupedGroupIds.forEach(assertCanUseAsGroupId);

  const codePlaceholders = dedupedCodes.map(() => "?").join(",");
  const watchlistCountRow = db
    .prepare(`SELECT COUNT(*) AS count FROM watchlist WHERE code IN (${codePlaceholders})`)
    .get(...dedupedCodes) as { count: number };
  if (watchlistCountRow.count !== dedupedCodes.length) {
    throw new Error("包含不在自选列表中的基金");
  }

  if (dedupedGroupIds.length > 0) {
    const groupPlaceholders = dedupedGroupIds.map(() => "?").join(",");
    const groupCountRow = db
      .prepare(`SELECT COUNT(*) AS count FROM fund_groups WHERE id IN (${groupPlaceholders})`)
      .get(...dedupedGroupIds) as { count: number };
    if (groupCountRow.count !== dedupedGroupIds.length) {
      throw new GroupNotFoundError();
    }
  }

  const tx = db.transaction((targetCodes: string[], targetGroupIds: string[]) => {
    const now = new Date().toISOString();
    const deleteStmt = db.prepare("DELETE FROM fund_group_memberships WHERE code = ?");
    const insertStmt = db.prepare(
      "INSERT INTO fund_group_memberships (code, group_id, created_at) VALUES (?, ?, ?)"
    );

    for (const code of targetCodes) {
      deleteStmt.run(code);
      for (const groupId of targetGroupIds) {
        insertStmt.run(code, groupId, now);
      }
    }
  });
  tx(dedupedCodes, dedupedGroupIds);

  return { updatedCount: dedupedCodes.length };
}

export function deleteWatchlistItems(codes: string[], db = getDb()): { deletedCount: number; deletedCodes: string[] } {
  const dedupedCodes = [...new Set(codes.map((code) => code.trim()).filter((code) => code.length > 0))];
  if (dedupedCodes.length === 0) {
    return { deletedCount: 0, deletedCodes: [] };
  }

  const placeholders = dedupedCodes.map(() => "?").join(",");
  const existingRows = db
    .prepare(`SELECT code FROM watchlist WHERE code IN (${placeholders})`)
    .all(...dedupedCodes) as Array<{ code: string }>;
  const existingCodes = existingRows.map((row) => row.code);
  if (existingCodes.length === 0) {
    return { deletedCount: 0, deletedCodes: [] };
  }

  const tx = db.transaction((targetCodes: string[]) => {
    const deleteStmt = db.prepare("DELETE FROM watchlist WHERE code = ?");
    for (const code of targetCodes) {
      deleteStmt.run(code);
    }
  });
  tx(existingCodes);

  return { deletedCount: existingCodes.length, deletedCodes: existingCodes };
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

function resolveGroupMeta(groupFilter: GroupFilter, db = getDb()): { groupId: GroupFilter; groupName: string } {
  if (!groupFilter || groupFilter === "all") {
    return { groupId: "all", groupName: "全部" };
  }
  if (groupFilter === "ungrouped") {
    return { groupId: "ungrouped", groupName: "未分组" };
  }
  const row = db.prepare("SELECT name FROM fund_groups WHERE id = ?").get(groupFilter) as
    | { name: string }
    | undefined;
  return {
    groupId: groupFilter,
    groupName: row?.name ?? "分组"
  };
}

function listCodesByGroupFilter(groupFilter: GroupFilter, db = getDb()): string[] {
  if (!groupFilter || groupFilter === "all") {
    return (db.prepare("SELECT code FROM watchlist ORDER BY created_at DESC").all() as Array<{ code: string }>).map(
      (row) => row.code
    );
  }

  if (groupFilter === "ungrouped") {
    return (
      db
        .prepare(
          `
      SELECT w.code AS code
      FROM watchlist w
      WHERE NOT EXISTS (
        SELECT 1 FROM fund_group_memberships m WHERE m.code = w.code
      )
      ORDER BY w.created_at DESC
      `
        )
        .all() as Array<{ code: string }>
    ).map((row) => row.code);
  }

  return (
    db
      .prepare(
        `
      SELECT w.code AS code
      FROM watchlist w
      WHERE EXISTS (
        SELECT 1
        FROM fund_group_memberships m
        WHERE m.code = w.code
          AND m.group_id = ?
      )
      ORDER BY w.created_at DESC
      `
      )
      .all(groupFilter) as Array<{ code: string }>
  ).map((row) => row.code);
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (valid.length === 0) {
    return null;
  }
  return valid.reduce((sum, current) => sum + current, 0) / valid.length;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getGroupPerformanceSummary(
  groupFilter: GroupFilter,
  date = getTodayShanghai(),
  db = getDb()
): GroupPerformanceSummary {
  const meta = resolveGroupMeta(groupFilter, db);
  const codes = listCodesByGroupFilter(groupFilter, db);
  const memberCount = codes.length;
  if (memberCount === 0) {
    return {
      groupId: meta.groupId,
      groupName: meta.groupName,
      memberCount: 0,
      todayAvgDeltaPct: null,
      sevenDayReturnPct: null,
      updatedAt: null
    };
  }

  const latestRows = db
    .prepare(
      `
      SELECT latest.code AS code, latest.delta_percent AS deltaPercent, latest.quote_ts AS quoteTs
      FROM intraday_points latest
      INNER JOIN (
        SELECT code, MAX(quote_ts) AS maxTs
        FROM intraday_points
        GROUP BY code
      ) latest_ts ON latest_ts.code = latest.code AND latest_ts.maxTs = latest.quote_ts
      WHERE latest.code IN (${codes.map(() => "?").join(",")})
      `
    )
    .all(...codes) as Array<{ code: string; deltaPercent: number | null; quoteTs: string }>;

  const todayAvgDeltaPct = average(latestRows.map((row) => row.deltaPercent));

  const startDate = dayjs(date).subtract(6, "day").format("YYYY-MM-DD");
  const sevenDayReturns = codes.map((code) => {
    const points = getHistoryPoints(code, startDate, date, db);
    if (points.length < 2) {
      return null;
    }
    const startNav = points[0]?.nav;
    const endNav = points[points.length - 1]?.nav;
    if (!startNav || !endNav || startNav <= 0) {
      return null;
    }
    return ((endNav - startNav) / startNav) * 100;
  });
  const sevenDayReturnPct = average(sevenDayReturns);

  const latestTs = latestRows
    .map((row) => row.quoteTs)
    .sort((a, b) => (a > b ? -1 : 1))[0];

  return {
    groupId: meta.groupId,
    groupName: meta.groupName,
    memberCount,
    todayAvgDeltaPct: todayAvgDeltaPct === null ? null : round2(todayAvgDeltaPct),
    sevenDayReturnPct: sevenDayReturnPct === null ? null : round2(sevenDayReturnPct),
    updatedAt: latestTs ?? null
  };
}

function parseTagsJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function mapReviewRow(row: {
  id: string;
  code: string;
  title: string;
  reviewDate: string;
  expectation: string;
  result: string;
  reason: string;
  actionPlan: string;
  tagsJson: string;
  createdAt: string;
  updatedAt: string;
}): FundReviewNote {
  const normalizedTitle = row.title.trim().length > 0 ? row.title.trim() : row.result.trim().slice(0, 60);
  return {
    id: row.id,
    code: row.code,
    title: normalizedTitle || `${row.reviewDate} 复盘`,
    reviewDate: row.reviewDate,
    expectation: row.expectation,
    result: row.result,
    reason: row.reason,
    actionPlan: row.actionPlan,
    tags: parseTagsJson(row.tagsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function listFundReviewNotes(code: string, db = getDb()): FundReviewNote[] {
  return (
    db
      .prepare(
        `
      SELECT
        id AS id,
        code AS code,
        title AS title,
        review_date AS reviewDate,
        expectation AS expectation,
        result AS result,
        reason AS reason,
        action_plan AS actionPlan,
        tags_json AS tagsJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM fund_review_notes
      WHERE code = ?
      ORDER BY review_date DESC, updated_at DESC
      `
      )
    .all(code) as Array<{
      id: string;
      code: string;
      title: string;
      reviewDate: string;
      expectation: string;
      result: string;
      reason: string;
      actionPlan: string;
      tagsJson: string;
      createdAt: string;
      updatedAt: string;
    }>
  ).map(mapReviewRow);
}

export function createFundReviewNote(
  input: {
    code: string;
    title: string;
    reviewDate: string;
    expectation: string;
    result: string;
    reason: string;
    actionPlan: string;
    tags: string[];
  },
  db = getDb()
): FundReviewNote {
  if (!hasWatchlistItem(input.code, db)) {
    throw new Error("该基金不在自选列表中");
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO fund_review_notes (
        id, code, title, review_date, expectation, result, reason, action_plan, tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.code,
    input.title,
    input.reviewDate,
    input.expectation,
    input.result,
    input.reason,
    input.actionPlan,
    JSON.stringify(input.tags ?? []),
    now,
    now
  );

  const row = db
    .prepare(
      `
      SELECT
        id AS id,
        code AS code,
        title AS title,
        review_date AS reviewDate,
        expectation AS expectation,
        result AS result,
        reason AS reason,
        action_plan AS actionPlan,
        tags_json AS tagsJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM fund_review_notes
      WHERE id = ?
      `
    )
    .get(id) as {
    id: string;
    code: string;
    title: string;
    reviewDate: string;
    expectation: string;
    result: string;
    reason: string;
    actionPlan: string;
    tagsJson: string;
    createdAt: string;
    updatedAt: string;
  };

  return mapReviewRow(row);
}

export function updateFundReviewNote(
  input: {
    id: string;
    code: string;
    title: string;
    reviewDate: string;
    expectation: string;
    result: string;
    reason: string;
    actionPlan: string;
    tags: string[];
  },
  db = getDb()
): FundReviewNote {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      UPDATE fund_review_notes
      SET
        title = ?,
        review_date = ?,
        expectation = ?,
        result = ?,
        reason = ?,
        action_plan = ?,
        tags_json = ?,
        updated_at = ?
      WHERE id = ? AND code = ?
      `
    )
    .run(
      input.title,
      input.reviewDate,
      input.expectation,
      input.result,
      input.reason,
      input.actionPlan,
      JSON.stringify(input.tags ?? []),
      now,
      input.id,
      input.code
    );

  if (result.changes === 0) {
    throw new ReviewNoteNotFoundError();
  }

  const row = db
    .prepare(
      `
      SELECT
        id AS id,
        code AS code,
        title AS title,
        review_date AS reviewDate,
        expectation AS expectation,
        result AS result,
        reason AS reason,
        action_plan AS actionPlan,
        tags_json AS tagsJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM fund_review_notes
      WHERE id = ?
      `
    )
    .get(input.id) as {
    id: string;
    code: string;
    title: string;
    reviewDate: string;
    expectation: string;
    result: string;
    reason: string;
    actionPlan: string;
    tagsJson: string;
    createdAt: string;
    updatedAt: string;
  };

  return mapReviewRow(row);
}

export function deleteFundReviewNote(id: string, code: string, db = getDb()): boolean {
  const result = db.prepare("DELETE FROM fund_review_notes WHERE id = ? AND code = ?").run(id, code);
  return result.changes > 0;
}

function normalizeChecklistStatus(status: string): DecisionChecklistStatus {
  if (status === "done" || status === "invalid") {
    return status;
  }
  return "todo";
}

function normalizeChecklistPriority(priority: string): DecisionChecklistPriority {
  if (priority === "high" || priority === "low") {
    return priority;
  }
  return "medium";
}

function mapChecklistRow(row: {
  id: string;
  code: string;
  tradeDate: string;
  triggerCondition: string;
  actionPlan: string;
  invalidCondition: string;
  reviewNote: string;
  status: string;
  priority: string;
  archivedReviewId: string | null;
  updatedAt: string;
}): DecisionChecklistItem {
  return {
    id: row.id,
    code: row.code,
    tradeDate: row.tradeDate,
    triggerCondition: row.triggerCondition,
    actionPlan: row.actionPlan,
    invalidCondition: row.invalidCondition,
    reviewNote: row.reviewNote,
    status: normalizeChecklistStatus(row.status),
    priority: normalizeChecklistPriority(row.priority),
    archivedReviewId: row.archivedReviewId,
    updatedAt: row.updatedAt
  };
}

function upsertChecklistArchiveToReview(itemId: string, db = getDb()): string | null {
  const row = db
    .prepare(
      `
      SELECT
        id AS id,
        code AS code,
        trade_date AS tradeDate,
        trigger_condition AS triggerCondition,
        action_plan AS actionPlan,
        invalid_condition AS invalidCondition,
        review_note AS reviewNote,
        status AS status,
        archived_review_id AS archivedReviewId
      FROM fund_decision_checklist_items
      WHERE id = ?
      `
    )
    .get(itemId) as
    | {
        id: string;
        code: string;
        tradeDate: string;
        triggerCondition: string;
        actionPlan: string;
        invalidCondition: string;
        reviewNote: string;
        status: string;
        archivedReviewId: string | null;
      }
    | undefined;
  if (!row) {
    return null;
  }
  const status = normalizeChecklistStatus(row.status);
  if (status === "todo") {
    return null;
  }
  if (row.reviewNote.trim().length === 0) {
    return null;
  }
  if (row.archivedReviewId) {
    return row.archivedReviewId;
  }

  const reviewId = randomUUID();
  const now = new Date().toISOString();
  const fallbackTitle = row.triggerCondition.trim().slice(0, 60) || `${row.tradeDate} 复盘`;
  db.prepare(
    `
      INSERT INTO fund_review_notes (
        id, code, title, review_date, expectation, result, reason, action_plan, record_kind, source_checklist_item_id, tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'decision', ?, ?, ?, ?)
      `
  ).run(
    reviewId,
    row.code,
    fallbackTitle,
    row.tradeDate,
    row.triggerCondition,
    row.reviewNote,
    row.invalidCondition,
    row.actionPlan,
    row.id,
    JSON.stringify(["checklist", status]),
    now,
    now
  );

  db.prepare("UPDATE fund_decision_checklist_items SET archived_review_id = ?, updated_at = ? WHERE id = ?").run(
    reviewId,
    now,
    row.id
  );
  return reviewId;
}

export function listDecisionChecklistItems(
  code: string,
  tradeDate: string,
  db = getDb()
): DecisionChecklistItem[] {
  return (
    db
      .prepare(
        `
      SELECT
        id AS id,
        code AS code,
        trade_date AS tradeDate,
        trigger_condition AS triggerCondition,
        action_plan AS actionPlan,
        invalid_condition AS invalidCondition,
        review_note AS reviewNote,
        status AS status,
        priority AS priority,
        archived_review_id AS archivedReviewId,
        updated_at AS updatedAt
      FROM fund_decision_checklist_items
      WHERE code = ? AND trade_date = ?
      ORDER BY
        CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
        updated_at DESC
      `
      )
      .all(code, tradeDate) as Array<{
      id: string;
      code: string;
      tradeDate: string;
      triggerCondition: string;
      actionPlan: string;
      invalidCondition: string;
      reviewNote: string;
      status: string;
      priority: string;
      archivedReviewId: string | null;
      updatedAt: string;
    }>
  ).map(mapChecklistRow);
}

export function createDecisionChecklistItem(
  input: {
    code: string;
    tradeDate: string;
    triggerCondition: string;
    actionPlan: string;
    invalidCondition: string;
    reviewNote: string;
    status: DecisionChecklistStatus;
    priority: DecisionChecklistPriority;
  },
  db = getDb()
): DecisionChecklistItem {
  if (!hasWatchlistItem(input.code, db)) {
    throw new Error("该基金不在自选列表中");
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO fund_decision_checklist_items (
        id, code, trade_date, trigger_condition, action_plan, invalid_condition, review_note, status, priority, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
  ).run(
    id,
    input.code,
    input.tradeDate,
    input.triggerCondition,
    input.actionPlan,
    input.invalidCondition,
    input.reviewNote,
    input.status,
    input.priority,
    now
  );

  upsertChecklistArchiveToReview(id, db);
  const row = db
    .prepare(
      `
      SELECT
        id AS id,
        code AS code,
        trade_date AS tradeDate,
        trigger_condition AS triggerCondition,
        action_plan AS actionPlan,
        invalid_condition AS invalidCondition,
        review_note AS reviewNote,
        status AS status,
        priority AS priority,
        archived_review_id AS archivedReviewId,
        updated_at AS updatedAt
      FROM fund_decision_checklist_items
      WHERE id = ?
      `
    )
    .get(id) as {
    id: string;
    code: string;
    tradeDate: string;
    triggerCondition: string;
    actionPlan: string;
    invalidCondition: string;
    reviewNote: string;
    status: string;
    priority: string;
    archivedReviewId: string | null;
    updatedAt: string;
  };
  return mapChecklistRow(row);
}

export function updateDecisionChecklistItem(
  input: {
    id: string;
    code: string;
    tradeDate: string;
    triggerCondition: string;
    actionPlan: string;
    invalidCondition: string;
    reviewNote: string;
    status: DecisionChecklistStatus;
    priority: DecisionChecklistPriority;
  },
  db = getDb()
): DecisionChecklistItem {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      UPDATE fund_decision_checklist_items
      SET
        trade_date = ?,
        trigger_condition = ?,
        action_plan = ?,
        invalid_condition = ?,
        review_note = ?,
        status = ?,
        priority = ?,
        updated_at = ?
      WHERE id = ? AND code = ?
      `
    )
    .run(
      input.tradeDate,
      input.triggerCondition,
      input.actionPlan,
      input.invalidCondition,
      input.reviewNote,
      input.status,
      input.priority,
      now,
      input.id,
      input.code
    );
  if (result.changes === 0) {
    throw new DecisionChecklistNotFoundError();
  }

  upsertChecklistArchiveToReview(input.id, db);
  const row = db
    .prepare(
      `
      SELECT
        id AS id,
        code AS code,
        trade_date AS tradeDate,
        trigger_condition AS triggerCondition,
        action_plan AS actionPlan,
        invalid_condition AS invalidCondition,
        review_note AS reviewNote,
        status AS status,
        priority AS priority,
        archived_review_id AS archivedReviewId,
        updated_at AS updatedAt
      FROM fund_decision_checklist_items
      WHERE id = ?
      `
    )
    .get(input.id) as {
    id: string;
    code: string;
    tradeDate: string;
    triggerCondition: string;
    actionPlan: string;
    invalidCondition: string;
    reviewNote: string;
    status: string;
    priority: string;
    archivedReviewId: string | null;
    updatedAt: string;
  };
  return mapChecklistRow(row);
}

export function deleteDecisionChecklistItem(id: string, code: string, db = getDb()): boolean {
  const result = db.prepare("DELETE FROM fund_decision_checklist_items WHERE id = ? AND code = ?").run(id, code);
  return result.changes > 0;
}

export function getDecisionSummaryByCodes(
  codes: string[],
  tradeDate = getTodayShanghai(),
  db = getDb()
): Record<string, DecisionPanelSummary> {
  if (codes.length === 0) {
    return {};
  }
  const placeholders = codes.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT
        code AS code,
        SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS todoCount,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS doneCount,
        SUM(CASE WHEN status = 'invalid' THEN 1 ELSE 0 END) AS invalidCount
      FROM fund_decision_checklist_items
      WHERE code IN (${placeholders})
        AND trade_date = ?
      GROUP BY code
      `
    )
    .all(...codes, tradeDate) as Array<{
    code: string;
    todoCount: number;
    doneCount: number;
    invalidCount: number;
  }>;

  const map: Record<string, DecisionPanelSummary> = {};
  for (const row of rows) {
    const done = row.doneCount ?? 0;
    const invalid = row.invalidCount ?? 0;
    const denominator = done + invalid;
    map[row.code] = {
      todoCount: row.todoCount ?? 0,
      doneCount: done,
      invalidCount: invalid,
      winRateHint: denominator > 0 ? round2((done / denominator) * 100) : null
    };
  }
  return map;
}

function listLatestReviewByCodes(codes: string[], db = getDb()): Record<string, FundReviewNote> {
  if (codes.length === 0) {
    return {};
  }

  const placeholders = codes.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT
        fr.id AS id,
        fr.code AS code,
        fr.title AS title,
        fr.review_date AS reviewDate,
        fr.expectation AS expectation,
        fr.result AS result,
        fr.reason AS reason,
        fr.action_plan AS actionPlan,
        fr.tags_json AS tagsJson,
        fr.created_at AS createdAt,
        fr.updated_at AS updatedAt
      FROM fund_review_notes fr
      INNER JOIN (
        SELECT code, MAX(updated_at) AS maxUpdatedAt
        FROM fund_review_notes
        WHERE code IN (${placeholders})
        GROUP BY code
      ) latest
        ON latest.code = fr.code
       AND latest.maxUpdatedAt = fr.updated_at
      `
    )
    .all(...codes) as Array<{
    id: string;
    code: string;
    title: string;
    reviewDate: string;
    expectation: string;
    result: string;
    reason: string;
    actionPlan: string;
    tagsJson: string;
    createdAt: string;
    updatedAt: string;
  }>;

  const mapped: Record<string, FundReviewNote> = {};
  for (const row of rows) {
    mapped[row.code] = mapReviewRow(row);
  }
  return mapped;
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
  const latestReviewByCode = listLatestReviewByCodes(
    rows.map((row) => row.code),
    db
  );
  const decisionSummaryByCode = getDecisionSummaryByCodes(
    rows.map((row) => row.code),
    date,
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
    groups: membershipsByCode[row.code] ?? [],
    latestReview: latestReviewByCode[row.code] ?? null,
    decisionSummary: decisionSummaryByCode[row.code] ?? {
      todoCount: 0,
      doneCount: 0,
      invalidCount: 0,
      winRateHint: null
    }
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
