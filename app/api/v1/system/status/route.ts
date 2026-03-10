import { NextResponse } from "next/server";
import { ensureCollectorStarted } from "@/lib/collector";
import { isTradingDay } from "@/lib/calendar";
import { getCollectorState } from "@/lib/db";
import { isTradingTime } from "@/lib/trading";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  ensureCollectorStarted();

  const state = getCollectorState();
  return NextResponse.json({
    ...state,
    isTradingDay: isTradingDay(),
    isTradingTime: isTradingTime()
  });
}
