import {
  addWatchlistItemWithStatus,
  addWatchlistItem,
  countIntradayPointsForCodeAndTs,
  createFundGroup,
  createIsolatedDb,
  deleteWatchlistItem,
  deletePositionSnapshot,
  getHistoryPoints,
  insertIntradayPoint,
  listFundGroups,
  listGroupTabs,
  listFundCards,
  reorderFundGroups,
  setFundGroupsForCode,
  upsertPositionSnapshot
} from "@/lib/db";
import { detectFundInstrumentType } from "@/lib/fund-kind";

function seedPoint(
  db: ReturnType<typeof createIsolatedDb>,
  input: {
    code: string;
    name: string;
    nav: number;
    estimatedNav: number;
    deltaPercent: number;
    quoteTs: string;
  }
) {
  insertIntradayPoint(
    {
      ...input,
      asOfDate: "2026-03-06",
      asOfTime: "10:00:00",
      instrumentType: detectFundInstrumentType(input.code),
      source: "eastmoney_estimation"
    },
    db
  );
}

describe("database fund queries", () => {
  it("supports dedupe on (code, quote_ts)", () => {
    const db = createIsolatedDb(":memory:");
    addWatchlistItem("161725", db);

    seedPoint(db, {
      code: "161725",
      name: "白酒指数",
      nav: 1,
      estimatedNav: 1.1,
      deltaPercent: 10,
      quoteTs: "2026-03-06T02:00:00.000Z"
    });

    seedPoint(db, {
      code: "161725",
      name: "白酒指数",
      nav: 1,
      estimatedNav: 1.2,
      deltaPercent: 20,
      quoteTs: "2026-03-06T02:00:00.000Z"
    });

    expect(countIntradayPointsForCodeAndTs("161725", "2026-03-06T02:00:00.000Z", db)).toBe(1);

    const cards = listFundCards({ sortBy: "default", date: "2026-03-06" }, db);
    expect(cards[0]?.estimatedNav).toBe(1.2);
  });

  it("sorts cards by delta asc/desc", () => {
    const db = createIsolatedDb(":memory:");
    ["161725", "110011", "320007"].forEach((code) => addWatchlistItem(code, db));

    seedPoint(db, {
      code: "161725",
      name: "A",
      nav: 1,
      estimatedNav: 1.03,
      deltaPercent: 3,
      quoteTs: "2026-03-06T02:00:00.000Z"
    });
    seedPoint(db, {
      code: "110011",
      name: "B",
      nav: 1,
      estimatedNav: 0.98,
      deltaPercent: -2,
      quoteTs: "2026-03-06T02:01:00.000Z"
    });
    seedPoint(db, {
      code: "320007",
      name: "C",
      nav: 1,
      estimatedNav: 1.01,
      deltaPercent: 1,
      quoteTs: "2026-03-06T02:02:00.000Z"
    });

    const desc = listFundCards({ sortBy: "deltaDesc", date: "2026-03-06" }, db).map((item) => item.code);
    const asc = listFundCards({ sortBy: "deltaAsc", date: "2026-03-06" }, db).map((item) => item.code);

    expect(desc).toEqual(["161725", "320007", "110011"]);
    expect(asc).toEqual(["110011", "320007", "161725"]);
  });

  it("reports watchlist create/delete status", () => {
    const db = createIsolatedDb(":memory:");
    const firstInsert = addWatchlistItemWithStatus("007049", db);
    const secondInsert = addWatchlistItemWithStatus("007049", db);

    expect(firstInsert.created).toBe(true);
    expect(secondInsert.created).toBe(false);

    expect(deleteWatchlistItem("007049", db)).toBe(true);
    expect(deleteWatchlistItem("007049", db)).toBe(false);
  });

  it("returns one history point per trading date using latest quote", () => {
    const db = createIsolatedDb(":memory:");
    addWatchlistItem("161725", db);

    insertIntradayPoint(
      {
        code: "161725",
        name: "白酒指数",
        nav: 1,
        estimatedNav: 1.01,
        deltaPercent: 1,
        quoteTs: "2026-03-05T01:31:00.000Z",
        asOfDate: "2026-03-05",
        asOfTime: "09:31:00",
        instrumentType: detectFundInstrumentType("161725"),
        source: "eastmoney_estimation"
      },
      db
    );
    insertIntradayPoint(
      {
        code: "161725",
        name: "白酒指数",
        nav: 1,
        estimatedNav: 1.03,
        deltaPercent: 3,
        quoteTs: "2026-03-05T07:00:00.000Z",
        asOfDate: "2026-03-05",
        asOfTime: "15:00:00",
        instrumentType: detectFundInstrumentType("161725"),
        source: "eastmoney_estimation"
      },
      db
    );
    insertIntradayPoint(
      {
        code: "161725",
        name: "白酒指数",
        nav: 1,
        estimatedNav: 1.06,
        deltaPercent: 6,
        quoteTs: "2026-03-06T07:00:00.000Z",
        asOfDate: "2026-03-06",
        asOfTime: "15:00:00",
        instrumentType: detectFundInstrumentType("161725"),
        source: "eastmoney_estimation"
      },
      db
    );

    const points = getHistoryPoints("161725", "2026-03-01", "2026-03-06", db);
    expect(points).toHaveLength(2);
    expect(points[0]?.nav).toBe(1.03);
    expect(points[1]?.nav).toBe(1.06);
  });

  it("calculates position metrics from snapshot and latest quote", () => {
    const db = createIsolatedDb(":memory:");
    addWatchlistItem("161725", db);

    seedPoint(db, {
      code: "161725",
      name: "白酒指数",
      nav: 1.2,
      estimatedNav: 1.23,
      deltaPercent: 2.5,
      quoteTs: "2026-03-06T02:00:00.000Z"
    });

    upsertPositionSnapshot(
      {
        code: "161725",
        shares: 1000.5,
        costPerUnit: 1.1,
        updatedAt: "2026-03-06T02:10:00.000Z"
      },
      db
    );

    const card = listFundCards({ sortBy: "default", date: "2026-03-06" }, db)[0];
    expect(card?.position?.shares).toBe(1000.5);
    expect(card?.position?.costPerUnit).toBe(1.1);
    expect(card?.positionMetrics.hasPosition).toBe(true);
    expect(card?.positionMetrics.costTotal).toBe(1100.55);
    expect(card?.positionMetrics.marketValue).toBe(1230.62);
    expect(card?.positionMetrics.totalPnl).toBe(130.07);
    expect(card?.positionMetrics.totalPnlPct).toBe(11.82);
    expect(card?.positionMetrics.dailyPnl).toBe(30.02);
  });

  it("clears position snapshot", () => {
    const db = createIsolatedDb(":memory:");
    addWatchlistItem("161725", db);
    upsertPositionSnapshot(
      {
        code: "161725",
        shares: 50,
        costPerUnit: 2
      },
      db
    );

    expect(deletePositionSnapshot("161725", db)).toBe(true);
    expect(deletePositionSnapshot("161725", db)).toBe(false);
    const card = listFundCards({ sortBy: "default", date: "2026-03-06" }, db)[0];
    expect(card?.position).toBeNull();
    expect(card?.positionMetrics.hasPosition).toBe(false);
  });

  it("supports multi-group mapping and filtering", () => {
    const db = createIsolatedDb(":memory:");
    addWatchlistItem("161725", db);
    addWatchlistItem("110011", db);
    addWatchlistItem("320007", db);

    const groupSemi = createFundGroup("半导体", db);
    const groupStable = createFundGroup("稳健", db);

    setFundGroupsForCode("161725", [groupSemi.id, groupStable.id], db);
    setFundGroupsForCode("110011", [groupSemi.id], db);

    seedPoint(db, {
      code: "161725",
      name: "A",
      nav: 1,
      estimatedNav: 1.01,
      deltaPercent: 1,
      quoteTs: "2026-03-06T02:00:00.000Z"
    });
    seedPoint(db, {
      code: "110011",
      name: "B",
      nav: 1,
      estimatedNav: 0.99,
      deltaPercent: -1,
      quoteTs: "2026-03-06T02:01:00.000Z"
    });
    seedPoint(db, {
      code: "320007",
      name: "C",
      nav: 1,
      estimatedNav: 1.02,
      deltaPercent: 2,
      quoteTs: "2026-03-06T02:02:00.000Z"
    });

    const semi = listFundCards({ sortBy: "default", date: "2026-03-06", groupFilter: groupSemi.id }, db);
    expect(semi.map((item) => item.code).sort()).toEqual(["110011", "161725"]);

    const ungrouped = listFundCards({ sortBy: "default", date: "2026-03-06", groupFilter: "ungrouped" }, db);
    expect(ungrouped.map((item) => item.code)).toEqual(["320007"]);

    const card = listFundCards({ sortBy: "default", date: "2026-03-06" }, db).find((item) => item.code === "161725");
    expect(card?.groups).toHaveLength(2);
    expect(card?.groups.map((item) => item.groupName)).toEqual(["半导体", "稳健"]);

    const tabs = listGroupTabs(db);
    expect(tabs[0]?.id).toBe("all");
    const semiTab = tabs.find((tab) => tab.id === groupSemi.id);
    expect(semiTab?.fundCount).toBe(2);
    expect(semiTab?.avgDeltaPercent).toBe(0);
  });

  it("reorders groups and keeps order stable", () => {
    const db = createIsolatedDb(":memory:");
    const g1 = createFundGroup("组A", db);
    const g2 = createFundGroup("组B", db);
    const g3 = createFundGroup("组C", db);
    reorderFundGroups([g3.id, g1.id, g2.id], db);
    const groups = listFundGroups(db);
    expect(groups.map((group) => group.name)).toEqual(["组C", "组A", "组B"]);
  });
});
