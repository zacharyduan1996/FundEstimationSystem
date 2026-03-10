import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deletePositionSnapshot, hasWatchlistItem, upsertPositionSnapshot } from "@/lib/db";

export const runtime = "nodejs";

const payloadSchema = z.object({
  shares: z.number().positive("持有份额必须大于 0"),
  costPerUnit: z.number().positive("单位持仓成本必须大于 0")
});

export async function PUT(
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

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }

  const snapshot = upsertPositionSnapshot({
    code,
    shares: parsed.data.shares,
    costPerUnit: parsed.data.costPerUnit
  });
  return NextResponse.json({ snapshot });
}

export async function DELETE(
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

  deletePositionSnapshot(code);
  return NextResponse.json({ ok: true });
}

