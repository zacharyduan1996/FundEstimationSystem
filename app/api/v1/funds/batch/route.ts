import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteWatchlistItems } from "@/lib/db";

export const runtime = "nodejs";

const payloadSchema = z.object({
  codes: z.array(z.string().trim().regex(/^\d{6}$/)).min(1, "至少选择一只基金").max(200)
});

export async function DELETE(request: NextRequest): Promise<NextResponse> {
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

  const result = deleteWatchlistItems(parsed.data.codes);
  return NextResponse.json(result);
}
