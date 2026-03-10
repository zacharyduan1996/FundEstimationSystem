import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

function createTempDbPath(): string {
  const file = `fund-position-${Date.now()}-${Math.random().toString(16).slice(2)}.db`;
  return path.join(os.tmpdir(), file);
}

describe("position api route", () => {
  it("supports upsert and clear position snapshot", async () => {
    const dbPath = createTempDbPath();
    process.env.DATABASE_PATH = dbPath;
    vi.resetModules();

    const dbModule = await import("@/lib/db");
    dbModule.addWatchlistItem("161725", dbModule.getDb());

    const routeModule = await import("@/app/api/v1/funds/[code]/position/route");

    const putRequest = new NextRequest("http://localhost/api/v1/funds/161725/position", {
      method: "PUT",
      body: JSON.stringify({ shares: 120.5, costPerUnit: 2.1 }),
      headers: { "content-type": "application/json" }
    });
    const putResponse = await routeModule.PUT(putRequest, { params: Promise.resolve({ code: "161725" }) });
    expect(putResponse.status).toBe(200);
    const putPayload = (await putResponse.json()) as {
      snapshot: { code: string; shares: number; costPerUnit: number };
    };
    expect(putPayload.snapshot.code).toBe("161725");
    expect(putPayload.snapshot.shares).toBe(120.5);
    expect(putPayload.snapshot.costPerUnit).toBe(2.1);

    const deleteRequest = new NextRequest("http://localhost/api/v1/funds/161725/position", {
      method: "DELETE"
    });
    const deleteResponse = await routeModule.DELETE(deleteRequest, {
      params: Promise.resolve({ code: "161725" })
    });
    expect(deleteResponse.status).toBe(200);
    const deletePayload = (await deleteResponse.json()) as { ok: boolean };
    expect(deletePayload.ok).toBe(true);

    delete process.env.DATABASE_PATH;
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it("validates payload", async () => {
    const dbPath = createTempDbPath();
    process.env.DATABASE_PATH = dbPath;
    vi.resetModules();

    const dbModule = await import("@/lib/db");
    dbModule.addWatchlistItem("161725", dbModule.getDb());
    const routeModule = await import("@/app/api/v1/funds/[code]/position/route");

    const badRequest = new NextRequest("http://localhost/api/v1/funds/161725/position", {
      method: "PUT",
      body: JSON.stringify({ shares: 0, costPerUnit: 2 }),
      headers: { "content-type": "application/json" }
    });
    const response = await routeModule.PUT(badRequest, { params: Promise.resolve({ code: "161725" }) });
    expect(response.status).toBe(400);

    delete process.env.DATABASE_PATH;
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });
});

