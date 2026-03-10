import type Database from "better-sqlite3";
import { RETENTION_DAYS, REFRESH_INTERVAL_MS, RETRY_DELAYS_MS } from "./constants";
import {
  cleanupOldPoints,
  getCollectorState,
  getDb,
  insertIntradayPoint,
  listWatchlist,
  updateCollectorState
} from "./db";
import { fetchFundSnapshotWithStrategy } from "./provider/eastmoney";
import { isTradingTime } from "./trading";
import { formatDateParts, sleep, toShanghai } from "./time";
import type { FundEstimationSourceRecord } from "./types";

type Fetcher = (code: string) => Promise<FundEstimationSourceRecord>;

let intervalHandle: NodeJS.Timeout | null = null;
let running = false;

async function fetchWithRetry(
  code: string,
  fetcher: Fetcher,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS
): Promise<FundEstimationSourceRecord> {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retryDelaysMs.length) {
    try {
      return await fetcher(code);
    } catch (error) {
      lastError = error;
      const delay = retryDelaysMs[attempt];
      if (!delay) {
        break;
      }
      await sleep(delay);
      attempt += 1;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown fetch error");
}

export async function collectOnce(
  options: {
    db?: Database.Database;
    fetcher?: Fetcher;
    now?: Date;
    retryDelaysMs?: readonly number[];
  } = {}
): Promise<{ success: number; failed: number }> {
  const db = options.db ?? getDb();
  const fetcher = options.fetcher ?? fetchFundSnapshotWithStrategy;
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const trading = isTradingTime(now);

  updateCollectorState(
    {
      lastRunAt: nowIso,
      isTradingTime: trading
    },
    db
  );

  const watchlist = listWatchlist(db);

  if (!trading || watchlist.length === 0) {
    cleanupOldPoints(RETENTION_DAYS, db);
    return { success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const item of watchlist) {
    try {
      const fund = await fetchWithRetry(item.code, fetcher, options.retryDelaysMs);
      const normalizedTs = toShanghai(fund.asOf).toISOString();
      const { asOfDate, asOfTime } = formatDateParts(normalizedTs);

      insertIntradayPoint(
        {
          code: fund.code,
          name: fund.name,
          nav: fund.nav,
          estimatedNav: fund.estimatedNav,
          deltaPercent: fund.deltaPercent,
          quoteTs: normalizedTs,
          asOfDate,
          asOfTime,
          instrumentType: fund.instrumentType,
          source: fund.source
        },
        db
      );
      success += 1;
    } catch (error) {
      failed += 1;
      lastError = error instanceof Error ? error.message : "Unknown collector error";
    }
  }

  const current = getCollectorState(db);
  const hasFailureOnly = success === 0 && failed > 0;

  updateCollectorState(
    {
      lastSuccessAt: success > 0 ? nowIso : current.lastSuccessAt,
      lastError,
      consecutiveFailures: hasFailureOnly ? current.consecutiveFailures + 1 : 0,
      sourceHealthy: !hasFailureOnly,
      isTradingTime: trading
    },
    db
  );

  cleanupOldPoints(RETENTION_DAYS, db);
  return { success, failed };
}

export function ensureCollectorStarted(): void {
  if (intervalHandle || process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  void runCollectorJob();
  intervalHandle = setInterval(() => {
    void runCollectorJob();
  }, REFRESH_INTERVAL_MS);
}

async function runCollectorJob(): Promise<void> {
  if (running) {
    return;
  }

  running = true;
  try {
    await collectOnce();
  } finally {
    running = false;
  }
}
