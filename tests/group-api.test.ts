import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

function createTempDbPath(): string {
  const file = `fund-group-${Date.now()}-${Math.random().toString(16).slice(2)}.db`;
  return path.join(os.tmpdir(), file);
}

describe("group api routes", () => {
  it("supports group CRUD and fund mapping", async () => {
    const dbPath = createTempDbPath();
    process.env.DATABASE_PATH = dbPath;
    vi.resetModules();

    const dbModule = await import("@/lib/db");
    dbModule.addWatchlistItem("161725", dbModule.getDb());

    const groupsRoute = await import("@/app/api/v1/groups/route");
    const groupIdRoute = await import("@/app/api/v1/groups/[id]/route");
    const mappingRoute = await import("@/app/api/v1/funds/[code]/groups/route");
    const fundsRoute = await import("@/app/api/v1/funds/route");

    const createReq = new NextRequest("http://localhost/api/v1/groups", {
      method: "POST",
      body: JSON.stringify({ name: "半导体" }),
      headers: { "content-type": "application/json" }
    });
    const createRes = await groupsRoute.POST(createReq);
    expect(createRes.status).toBe(201);
    const createPayload = (await createRes.json()) as { group: { id: string } };
    const groupId = createPayload.group.id;

    const mapReq = new NextRequest("http://localhost/api/v1/funds/161725/groups", {
      method: "PUT",
      body: JSON.stringify({ groupIds: [groupId] }),
      headers: { "content-type": "application/json" }
    });
    const mapRes = await mappingRoute.PUT(mapReq, { params: Promise.resolve({ code: "161725" }) });
    expect(mapRes.status).toBe(200);

    const listReq = new NextRequest(`http://localhost/api/v1/funds?groupId=${groupId}`);
    const listRes = await fundsRoute.GET(listReq);
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as { funds: Array<{ code: string }> };
    expect(listPayload.funds.map((item) => item.code)).toEqual(["161725"]);

    const renameReq = new NextRequest(`http://localhost/api/v1/groups/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "半导体精选" }),
      headers: { "content-type": "application/json" }
    });
    const renameRes = await groupIdRoute.PATCH(renameReq, { params: Promise.resolve({ id: groupId }) });
    expect(renameRes.status).toBe(200);

    const deleteReq = new NextRequest(`http://localhost/api/v1/groups/${groupId}`, { method: "DELETE" });
    const deleteRes = await groupIdRoute.DELETE(deleteReq, { params: Promise.resolve({ id: groupId }) });
    expect(deleteRes.status).toBe(200);

    delete process.env.DATABASE_PATH;
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });
});
