import { NextRequest, NextResponse } from "next/server";
import { ensureCollectorStarted } from "@/lib/collector";
import { getHistoryPoints } from "@/lib/db";
import { buildHistoryAnalysis, getRangeStartDate, resolveHistoryRange } from "@/lib/history";
import { getTodayShanghai } from "@/lib/time";
import { isStale } from "@/lib/trading";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
): Promise<NextResponse> {
  ensureCollectorStarted();

  const { code } = await context.params;
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "基金代码必须为 6 位数字" }, { status: 400 });
  }

  const range = resolveHistoryRange(request.nextUrl.searchParams.get("range"));
  const endDate = getTodayShanghai();
  const startDate = getRangeStartDate(range, endDate);

  const points = getHistoryPoints(code, startDate, endDate);
  const latestTs = points[points.length - 1]?.ts ?? null;
  const fromCache = latestTs ? isStale(latestTs) : true;
  const analysis = buildHistoryAnalysis(range, points, fromCache);

  return NextResponse.json({
    code,
    range,
    startDate,
    endDate,
    analysis
  });
}

