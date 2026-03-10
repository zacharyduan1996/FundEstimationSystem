import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createFundGroup, GroupLimitExceededError, GroupNameConflictError, listFundGroups } from "@/lib/db";

export const runtime = "nodejs";

const payloadSchema = z.object({
  name: z.string().trim().min(1, "分组名称不能为空").max(20, "分组名称不能超过 20 个字符")
});

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ groups: listFundGroups() });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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
    const group = createFundGroup(parsed.data.name);
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    if (error instanceof GroupLimitExceededError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof GroupNameConflictError) {
      return NextResponse.json({ error: "分组名称已存在" }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "创建分组失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
