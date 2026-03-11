import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createFundReviewNote, hasWatchlistItem, listFundReviewNotes } from "@/lib/db";

export const runtime = "nodejs";

const reviewInputSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(60, "标题最多 60 字"),
  reviewDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD"),
  expectation: z.string().trim().min(1, "预期不能为空").max(400, "预期最多 400 字"),
  result: z.string().trim().min(1, "结果不能为空").max(400, "结果最多 400 字"),
  reason: z.string().trim().min(1, "原因不能为空").max(400, "原因最多 400 字"),
  actionPlan: z.string().trim().min(1, "改进动作不能为空").max(400, "改进动作最多 400 字"),
  tags: z.array(z.string().trim().min(1).max(20)).max(10).optional().default([])
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ code: string }> }
): Promise<NextResponse> {
  const { code } = await context.params;
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "基金代码必须为 6 位数字" }, { status: 400 });
  }
  if (!hasWatchlistItem(code)) {
    return NextResponse.json({ error: "该基金不在自选列表中" }, { status: 404 });
  }

  return NextResponse.json({ code, notes: listFundReviewNotes(code) });
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

  const parsed = reviewInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }

  const note = createFundReviewNote({
    code,
    title: parsed.data.title,
    reviewDate: parsed.data.reviewDate,
    expectation: parsed.data.expectation,
    result: parsed.data.result,
    reason: parsed.data.reason,
    actionPlan: parsed.data.actionPlan,
    tags: parsed.data.tags
  });

  return NextResponse.json({ note }, { status: 201 });
}
