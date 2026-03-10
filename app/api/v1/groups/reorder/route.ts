import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GroupNotFoundError, reorderFundGroups } from "@/lib/db";

export const runtime = "nodejs";

const payloadSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1, "至少包含一个分组 ID")
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
    const groups = reorderFundGroups(parsed.data.ids);
    return NextResponse.json({ groups });
  } catch (error) {
    if (error instanceof GroupNotFoundError) {
      return NextResponse.json({ error: "包含不存在的分组" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "分组排序保存失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
