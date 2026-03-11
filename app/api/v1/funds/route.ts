import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { collectOnce, ensureCollectorStarted } from "@/lib/collector";
import {
  addWatchlistItemWithStatus,
  GroupNotFoundError,
  getCollectorState,
  getDb,
  getGroupPerformanceSummary,
  insertIntradayPoint,
  listFundGroups,
  listGroupTabs,
  listFundCards,
  listWatchlist,
  setFundGroupsForCode
} from "@/lib/db";
import { fetchFundSnapshotWithStrategy, fetchRealtimeTrendIfAvailable } from "@/lib/provider/eastmoney";
import { formatDateParts, getTodayShanghai, toShanghai } from "@/lib/time";
import type { FundCardData, GroupFilter, LoadingState, SortBy } from "@/lib/types";

export const runtime = "nodejs";

const payloadSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "基金代码必须为 6 位数字"),
  groupIds: z.array(z.string().trim().min(1)).max(20).optional().default([])
});

function resolveSortBy(sortBy: string | null): SortBy {
  if (sortBy === "deltaDesc" || sortBy === "deltaAsc") {
    return sortBy;
  }

  return "default";
}

function resolveGroupFilter(groupId: string | null): GroupFilter {
  if (!groupId || groupId.trim() === "") {
    return "all";
  }

  if (groupId === "all" || groupId === "ungrouped") {
    return groupId;
  }

  return groupId.trim();
}

function ensureVisibleTrendPoints(fund: FundCardData): FundCardData {
  if (fund.trendPoints.length >= 2) {
    return fund;
  }

  if (!fund.asOfDate || !fund.asOfTime || fund.estimatedNav === null || fund.nav === null) {
    return fund;
  }

  const startTs = new Date(`${fund.asOfDate}T09:30:00+08:00`).toISOString();
  const endTs = new Date(`${fund.asOfDate}T${fund.asOfTime}+08:00`).toISOString();

  if (startTs === endTs) {
    return fund;
  }

  return {
    ...fund,
    trendPoints: [
      {
        ts: startTs,
        estimatedNav: fund.nav,
        deltaPercent: 0
      },
      {
        ts: endTs,
        estimatedNav: fund.estimatedNav,
        deltaPercent: fund.deltaPercent ?? 0
      }
    ]
  };
}

async function hydrateSnapshotForCode(code: string): Promise<boolean> {
  try {
    const record = await fetchFundSnapshotWithStrategy(code);
    const normalizedTs = toShanghai(record.asOf).toISOString();
    const { asOfDate, asOfTime } = formatDateParts(normalizedTs);

    insertIntradayPoint(
      {
        code: record.code,
        name: record.name,
        nav: record.nav,
        estimatedNav: record.estimatedNav,
        deltaPercent: record.deltaPercent,
        quoteTs: normalizedTs,
        asOfDate,
        asOfTime,
        instrumentType: record.instrumentType,
        source: record.source
      },
      getDb()
    );
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    ensureCollectorStarted();

    const query = request.nextUrl.searchParams.get("query") ?? "";
    const sortBy = resolveSortBy(request.nextUrl.searchParams.get("sortBy"));
    const groupFilter = resolveGroupFilter(request.nextUrl.searchParams.get("groupId"));
    const workspace = request.nextUrl.searchParams.get("workspace") ?? "dashboard";

    const watchlist = listWatchlist();
    let funds = listFundCards({ query, sortBy, groupFilter });
    const missingCodes = funds.filter((item) => item.estimatedNav === null).map((item) => item.code);
    if (missingCodes.length > 0) {
      const hydrated = await Promise.all(missingCodes.map((code) => hydrateSnapshotForCode(code)));
      if (hydrated.some(Boolean)) {
        funds = listFundCards({ query, sortBy, groupFilter });
      }
    }

    const today = getTodayShanghai();
    await Promise.all(
      funds.map(async (item) => {
        const realtimeTrend = await fetchRealtimeTrendIfAvailable(item.code, today);
        if (realtimeTrend) {
          item.trendPoints = realtimeTrend;
        }
      })
    );
    funds = funds.map(ensureVisibleTrendPoints);

    let loadingState: LoadingState = "idle";
    if (watchlist.length === 0) {
      loadingState = "empty";
    } else if (funds.length === 0 && (query.trim().length > 0 || groupFilter !== "all")) {
      loadingState = "noResult";
    }

    const collectorState = getCollectorState();
    const groups = listFundGroups();
    const groupTabs = listGroupTabs();
    const groupPerformance = getGroupPerformanceSummary(groupFilter);
    const decisionSummaryByFund = Object.fromEntries(
      funds.map((fund) => [fund.code, fund.decisionSummary ?? { todoCount: 0, doneCount: 0, invalidCount: 0, winRateHint: null }])
    );
    return NextResponse.json({
      workspace,
      query,
      sortBy,
      groupFilter,
      groups,
      groupTabs,
      groupPerformance,
      focusedCode: workspace === "intraday" ? funds[0]?.code ?? null : null,
      decisionSummaryByFund,
      funds,
      loadingState,
      lastUpdatedAt: collectorState.lastSuccessAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "fund list failed";
    const isSourceError = /(eastmoney|fetch|request failed|jsonp|minute trend)/i.test(message);
    return NextResponse.json(
      {
        error: isSourceError ? "data_source_unavailable" : "internal_error",
        message: isSourceError ? "数据源暂时不可用，请稍后重试" : "系统异常，请稍后重试"
      },
      { status: isSourceError ? 503 : 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  ensureCollectorStarted();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }

  const { item, created } = addWatchlistItemWithStatus(parsed.data.code);
  try {
    if (parsed.data.groupIds.length > 0) {
      setFundGroupsForCode(parsed.data.code, parsed.data.groupIds);
    }
  } catch (error) {
    if (error instanceof GroupNotFoundError) {
      return NextResponse.json({ error: "包含不存在的分组" }, { status: 400 });
    }
    throw error;
  }
  const hydrated = await hydrateSnapshotForCode(parsed.data.code);
  if (!hydrated) {
    await collectOnce();
  }

  return NextResponse.json({ item, created }, { status: created ? 201 : 200 });
}
