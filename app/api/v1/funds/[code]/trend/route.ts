import { NextRequest, NextResponse } from "next/server";
import { ensureCollectorStarted } from "@/lib/collector";
import { getTrendPoints } from "@/lib/db";
import { fetchRealtimeTrendIfAvailable } from "@/lib/provider/eastmoney";
import { getTodayShanghai } from "@/lib/time";

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

  const date = request.nextUrl.searchParams.get("date") ?? getTodayShanghai();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date 格式必须为 YYYY-MM-DD" }, { status: 400 });
  }

  const realtimeTrendPoints = await fetchRealtimeTrendIfAvailable(code, date);
  const trendPoints = realtimeTrendPoints ?? getTrendPoints(code, date);
  return NextResponse.json({ code, date, trendPoints });
}
