import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GroupNotFoundError, setFundGroupsForCodes } from "@/lib/db";

export const runtime = "nodejs";

const payloadSchema = z.object({
  codes: z.array(z.string().trim().regex(/^\d{6}$/)).min(1, "至少选择一只基金").max(200),
  groupIds: z.array(z.string().trim().min(1)).max(20).default([])
});

export async function PUT(request: NextRequest): Promise<NextResponse> {
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

  try {
    const result = setFundGroupsForCodes(parsed.data.codes, parsed.data.groupIds);
    return NextResponse.json({
      updatedCount: result.updatedCount,
      codes: parsed.data.codes
    });
  } catch (error) {
    if (error instanceof GroupNotFoundError) {
      return NextResponse.json({ error: "包含不存在的分组" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "批量分组失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
