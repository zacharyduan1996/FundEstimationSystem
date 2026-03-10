import { collectOnce } from "@/lib/collector";
import { addWatchlistItem, createIsolatedDb, getCollectorState, getTrendPoints, listFundCards } from "@/lib/db";

describe("collector integration", () => {
  it("writes intraday points and exposes them through card query", async () => {
    const db = createIsolatedDb(":memory:");
    addWatchlistItem("161725", db);

    await collectOnce({
      db,
      now: new Date("2026-03-06T02:00:00.000Z"),
      retryDelaysMs: [],
      fetcher: async () => ({
        code: "161725",
        name: "白酒指数",
        nav: 1.12,
        estimatedNav: 1.15,
        deltaPercent: 2.68,
        asOf: "2026-03-06T10:00:00+08:00",
        instrumentType: "lof",
        source: "eastmoney_estimation"
      })
    });

    const cards = listFundCards({ sortBy: "default", date: "2026-03-06" }, db);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.code).toBe("161725");
    expect(cards[0]?.trendPoints.length).toBe(1);

    const trend = getTrendPoints("161725", "2026-03-06", db);
    expect(trend[0]?.estimatedNav).toBe(1.15);

    const state = getCollectorState(db);
    expect(state.lastSuccessAt).not.toBeNull();
    expect(state.sourceHealthy).toBe(true);
  });

  it("records failures and keeps health false when all requests fail", async () => {
    const db = createIsolatedDb(":memory:");
    addWatchlistItem("161725", db);

    await collectOnce({
      db,
      now: new Date("2026-03-06T02:00:00.000Z"),
      retryDelaysMs: [],
      fetcher: async () => {
        throw new Error("boom");
      }
    });

    const state = getCollectorState(db);
    expect(state.sourceHealthy).toBe(false);
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastError).toContain("boom");
  });
});
