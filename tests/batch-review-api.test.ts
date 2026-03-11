import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

function createTempDbPath(prefix: string): string {
  const file = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`;
  return path.join(os.tmpdir(), file);
}

describe("batch and review api routes", () => {
  it("supports batch group assignment and batch delete", async () => {
    const dbPath = createTempDbPath("fund-batch");
    process.env.DATABASE_PATH = dbPath;
    vi.resetModules();

    const dbModule = await import("@/lib/db");
    dbModule.addWatchlistItem("161725", dbModule.getDb());
    dbModule.addWatchlistItem("110011", dbModule.getDb());
    const group = dbModule.createFundGroup("核心", dbModule.getDb());

    const batchGroupRoute = await import("@/app/api/v1/funds/batch/groups/route");
    const batchDeleteRoute = await import("@/app/api/v1/funds/batch/route");

    const batchGroupRequest = new NextRequest("http://localhost/api/v1/funds/batch/groups", {
      method: "PUT",
      body: JSON.stringify({ codes: ["161725", "110011"], groupIds: [group.id] }),
      headers: { "content-type": "application/json" }
    });
    const batchGroupResponse = await batchGroupRoute.PUT(batchGroupRequest);
    expect(batchGroupResponse.status).toBe(200);

    const grouped = dbModule.listFundCards({ groupFilter: group.id }, dbModule.getDb());
    expect(grouped.map((item) => item.code).sort()).toEqual(["110011", "161725"]);

    const batchDeleteRequest = new NextRequest("http://localhost/api/v1/funds/batch", {
      method: "DELETE",
      body: JSON.stringify({ codes: ["110011"] }),
      headers: { "content-type": "application/json" }
    });
    const batchDeleteResponse = await batchDeleteRoute.DELETE(batchDeleteRequest);
    expect(batchDeleteResponse.status).toBe(200);
    const payload = (await batchDeleteResponse.json()) as { deletedCount: number };
    expect(payload.deletedCount).toBe(1);

    delete process.env.DATABASE_PATH;
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it("supports review note CRUD routes", async () => {
    const dbPath = createTempDbPath("fund-review");
    process.env.DATABASE_PATH = dbPath;
    vi.resetModules();

    const dbModule = await import("@/lib/db");
    dbModule.addWatchlistItem("161725", dbModule.getDb());

    const reviewsRoute = await import("@/app/api/v1/funds/[code]/reviews/route");
    const reviewIdRoute = await import("@/app/api/v1/funds/[code]/reviews/[id]/route");

    const createRequest = new NextRequest("http://localhost/api/v1/funds/161725/reviews", {
      method: "POST",
      body: JSON.stringify({
        title: "半导体盘中复盘",
        reviewDate: "2026-03-10",
        expectation: "预期反弹",
        result: "结果震荡",
        reason: "板块无持续性",
        actionPlan: "控制仓位",
        tags: ["半导体"]
      }),
      headers: { "content-type": "application/json" }
    });
    const createResponse = await reviewsRoute.POST(createRequest, { params: Promise.resolve({ code: "161725" }) });
    expect(createResponse.status).toBe(201);
    const createPayload = (await createResponse.json()) as { note: { id: string } };
    const noteId = createPayload.note.id;

    const listResponse = await reviewsRoute.GET(new NextRequest("http://localhost/api/v1/funds/161725/reviews"), {
      params: Promise.resolve({ code: "161725" })
    });
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as { notes: Array<{ id: string }> };
    expect(listPayload.notes).toHaveLength(1);

    const updateRequest = new NextRequest(`http://localhost/api/v1/funds/161725/reviews/${noteId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: "半导体盘后总结",
        reviewDate: "2026-03-10",
        expectation: "预期弱反弹",
        result: "结果下跌",
        reason: "成交量不足",
        actionPlan: "降低仓位",
        tags: ["复盘"]
      }),
      headers: { "content-type": "application/json" }
    });
    const updateResponse = await reviewIdRoute.PUT(updateRequest, {
      params: Promise.resolve({ code: "161725", id: noteId })
    });
    expect(updateResponse.status).toBe(200);

    const deleteResponse = await reviewIdRoute.DELETE(
      new NextRequest(`http://localhost/api/v1/funds/161725/reviews/${noteId}`, { method: "DELETE" }),
      { params: Promise.resolve({ code: "161725", id: noteId }) }
    );
    expect(deleteResponse.status).toBe(200);

    delete process.env.DATABASE_PATH;
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it("supports decision checklist CRUD routes", async () => {
    const dbPath = createTempDbPath("fund-checklist");
    process.env.DATABASE_PATH = dbPath;
    vi.resetModules();

    const dbModule = await import("@/lib/db");
    dbModule.addWatchlistItem("161725", dbModule.getDb());

    const checklistRoute = await import("@/app/api/v1/funds/[code]/checklist/route");
    const checklistIdRoute = await import("@/app/api/v1/funds/[code]/checklist/[id]/route");

    const createRequest = new NextRequest("http://localhost/api/v1/funds/161725/checklist", {
      method: "POST",
      body: JSON.stringify({
        tradeDate: "2026-03-10",
        triggerCondition: "跌破 2.26",
        actionPlan: "减仓 20%",
        invalidCondition: "放量反包",
        reviewNote: "",
        status: "todo",
        priority: "medium"
      }),
      headers: { "content-type": "application/json" }
    });
    const createResponse = await checklistRoute.POST(createRequest, { params: Promise.resolve({ code: "161725" }) });
    expect(createResponse.status).toBe(201);
    const createPayload = (await createResponse.json()) as { item: { id: string } };
    const itemId = createPayload.item.id;

    const listResponse = await checklistRoute.GET(
      new NextRequest("http://localhost/api/v1/funds/161725/checklist?date=2026-03-10"),
      { params: Promise.resolve({ code: "161725" }) }
    );
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as { items: Array<{ id: string }> };
    expect(listPayload.items).toHaveLength(1);

    const updateRequest = new NextRequest(`http://localhost/api/v1/funds/161725/checklist/${itemId}`, {
      method: "PUT",
      body: JSON.stringify({
        tradeDate: "2026-03-10",
        triggerCondition: "跌破 2.26",
        actionPlan: "减仓 20%",
        invalidCondition: "放量反包",
        reviewNote: "执行后回撤收窄",
        status: "done",
        priority: "high"
      }),
      headers: { "content-type": "application/json" }
    });
    const updateResponse = await checklistIdRoute.PUT(updateRequest, {
      params: Promise.resolve({ code: "161725", id: itemId })
    });
    expect(updateResponse.status).toBe(200);

    const deleteResponse = await checklistIdRoute.DELETE(
      new NextRequest(`http://localhost/api/v1/funds/161725/checklist/${itemId}`, { method: "DELETE" }),
      { params: Promise.resolve({ code: "161725", id: itemId }) }
    );
    expect(deleteResponse.status).toBe(200);

    delete process.env.DATABASE_PATH;
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });
});
