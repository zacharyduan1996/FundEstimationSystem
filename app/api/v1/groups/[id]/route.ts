import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteFundGroup, GroupNameConflictError, GroupNotFoundError, renameFundGroup } from "@/lib/db";

export const runtime = "nodejs";

const payloadSchema = z.object({
  name: z.string().trim().min(1, "分组名称不能为空").max(20, "分组名称不能超过 20 个字符")
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;

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
    const group = renameFundGroup(id, parsed.data.name);
    return NextResponse.json({ group });
  } catch (error) {
    if (error instanceof GroupNotFoundError) {
      return NextResponse.json({ error: "分组不存在" }, { status: 404 });
    }
    if (error instanceof GroupNameConflictError) {
      return NextResponse.json({ error: "分组名称已存在" }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "重命名分组失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  const deleted = deleteFundGroup(id);
  if (!deleted) {
    return NextResponse.json({ error: "分组不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
