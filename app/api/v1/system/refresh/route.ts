import { NextRequest, NextResponse } from "next/server";
import { collectOnce } from "@/lib/collector";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const result = await collectOnce();
    return NextResponse.json({
      success: true,
      message: `已刷新 ${result.success} 个基金数据，失败 ${result.failed} 个`,
      data: result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "刷新数据失败";
    return NextResponse.json(
      {
        success: false,
        error: message
      },
      { status: 500 }
    );
  }
}
