import { NextRequest, NextResponse } from "next/server";
import { deleteWatchlistItem } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ code: string }> }
): Promise<NextResponse> {
  const { code } = await context.params;
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "基金代码必须为 6 位数字" }, { status: 400 });
  }

  const deleted = deleteWatchlistItem(code);
  if (!deleted) {
    return NextResponse.json({ error: "该基金不在自选列表中" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
