import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDecisionChecklistItem,
  hasWatchlistItem,
  listDecisionChecklistItems
} from "@/lib/db";
import { getTodayShanghai } from "@/lib/time";
import type { DecisionChecklistPriority, DecisionChecklistStatus } from "@/lib/types";

export const runtime = "nodejs";

const checklistSchema = z.object({
  tradeDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD"),
  triggerCondition: z.string().trim().min(1, "触发条件不能为空").max(200),
  actionPlan: z.string().trim().min(1, "执行动作不能为空").max(200),
  invalidCondition: z.string().trim().min(1, "失效条件不能为空").max(200),
  reviewNote: z.string().trim().max(400).default(""),
  status: z.enum(["todo", "done", "invalid"]).default("todo"),
  priority: z.enum(["high", "medium", "low"]).default("medium")
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
): Promise<NextResponse> {
  const { code } = await context.params;
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "基金代码必须为 6 位数字" }, { status: 400 });
  }
  if (!hasWatchlistItem(code)) {
    return NextResponse.json({ error: "该基金不在自选列表中" }, { status: 404 });
  }

  const date = request.nextUrl.searchParams.get("date") ?? getTodayShanghai();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "日期格式必须为 YYYY-MM-DD" }, { status: 400 });
  }

  return NextResponse.json({
    code,
    date,
    items: listDecisionChecklistItems(code, date)
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
): Promise<NextResponse> {
  const { code } = await context.params;
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "基金代码必须为 6 位数字" }, { status: 400 });
  }
  if (!hasWatchlistItem(code)) {
    return NextResponse.json({ error: "该基金不在自选列表中" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const parsed = checklistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }

  const item = createDecisionChecklistItem({
    code,
    tradeDate: parsed.data.tradeDate,
    triggerCondition: parsed.data.triggerCondition,
    actionPlan: parsed.data.actionPlan,
    invalidCondition: parsed.data.invalidCondition,
    reviewNote: parsed.data.reviewNote,
    status: parsed.data.status as DecisionChecklistStatus,
    priority: parsed.data.priority as DecisionChecklistPriority
  });

  return NextResponse.json({ item }, { status: 201 });
}
