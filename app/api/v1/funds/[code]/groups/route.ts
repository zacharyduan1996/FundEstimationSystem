import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GroupNotFoundError, setFundGroupsForCode } from "@/lib/db";

export const runtime = "nodejs";

const payloadSchema = z.object({
  groupIds: z.array(z.string().trim().min(1)).max(20)
});

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
): Promise<NextResponse> {
  const { code } = await context.params;
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "基金代码必须为 6 位数字" }, { status: 400 });
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

  try {
    const groups = setFundGroupsForCode(code, parsed.data.groupIds);
    return NextResponse.json({ code, groups });
  } catch (error) {
    if (error instanceof GroupNotFoundError) {
      return NextResponse.json({ error: "分组不存在" }, { status: 404 });
    }
    if (error instanceof Error && /不在自选列表中/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "保存分组失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
