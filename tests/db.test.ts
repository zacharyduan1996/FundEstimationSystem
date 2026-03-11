import {
  addWatchlistItemWithStatus,
  addWatchlistItem,
  countIntradayPointsForCodeAndTs,
  createDecisionChecklistItem,
  createFundReviewNote,
  createFundGroup,
  createIsolatedDb,
  deleteDecisionChecklistItem,
  deleteWatchlistItems,
  deleteWatchlistItem,
  deletePositionSnapshot,
  getDecisionSummaryByCodes,
  getGroupPerformanceSummary,
  getHistoryPoints,
  insertIntradayPoint,
  listDecisionChecklistItems,
  listFundGroups,
  listFundReviewNotes,
  listGroupTabs,
  listFundCards,
  reorderFundGroups,
  setFundGroupsForCodes,
  setFundGroupsForCode,
  updateDecisionChecklistItem,
  updateFundReviewNote,
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

  it("calculates group performance summary with 7D return", () => {
    const db = createIsolatedDb(":memory:");
    addWatchlistItem("161725", db);
    addWatchlistItem("110011", db);

    insertIntradayPoint(
      {
        code: "161725",
        name: "A",
        nav: 1,
        estimatedNav: 1.1,
        deltaPercent: 2,
        quoteTs: "2026-03-01T07:00:00.000Z",
        asOfDate: "2026-03-01",
        asOfTime: "15:00:00",
        instrumentType: detectFundInstrumentType("161725"),
        source: "eastmoney_estimation"
      },
      db
    );
    insertIntradayPoint(
      {
        code: "161725",
        name: "A",
        nav: 1,
        estimatedNav: 1.2,
        deltaPercent: 4,
        quoteTs: "2026-03-07T07:00:00.000Z",
        asOfDate: "2026-03-07",
        asOfTime: "15:00:00",
        instrumentType: detectFundInstrumentType("161725"),
        source: "eastmoney_estimation"
      },
      db
    );

    insertIntradayPoint(
      {
        code: "110011",
        name: "B",
        nav: 1,
        estimatedNav: 2,
        deltaPercent: -1,
        quoteTs: "2026-03-01T07:00:00.000Z",
        asOfDate: "2026-03-01",
        asOfTime: "15:00:00",
        instrumentType: detectFundInstrumentType("110011"),
        source: "eastmoney_estimation"
      },
      db
    );
    insertIntradayPoint(
      {
        code: "110011",
        name: "B",
        nav: 1,
        estimatedNav: 2.2,
        deltaPercent: 2,
        quoteTs: "2026-03-07T07:00:00.000Z",
        asOfDate: "2026-03-07",
        asOfTime: "15:00:00",
        instrumentType: detectFundInstrumentType("110011"),
        source: "eastmoney_estimation"
      },
      db
    );

    const summary = getGroupPerformanceSummary("all", "2026-03-07", db);
    expect(summary.memberCount).toBe(2);
    expect(summary.todayAvgDeltaPct).toBe(3);
    expect(summary.sevenDayReturnPct).toBe(9.55);
  });

  it("supports batch group assignment and batch delete", () => {
    const db = createIsolatedDb(":memory:");
    addWatchlistItem("161725", db);
    addWatchlistItem("110011", db);
    addWatchlistItem("007049", db);

    const group = createFundGroup("核心", db);
    const assigned = setFundGroupsForCodes(["161725", "110011"], [group.id], db);
    expect(assigned.updatedCount).toBe(2);

    const inGroup = listFundCards({ groupFilter: group.id, date: "2026-03-07" }, db);
    expect(inGroup.map((item) => item.code).sort()).toEqual(["110011", "161725"]);

    const deleted = deleteWatchlistItems(["110011", "007049"], db);
    expect(deleted.deletedCount).toBe(2);
    expect(listFundCards({ date: "2026-03-07" }, db).map((item) => item.code)).toEqual(["161725"]);
  });

  it("supports review note CRUD and latest review on card", () => {
    const db = createIsolatedDb(":memory:");
    addWatchlistItem("161725", db);
    seedPoint(db, {
      code: "161725",
      name: "A",
      nav: 1,
      estimatedNav: 1.01,
      deltaPercent: 1,
      quoteTs: "2026-03-07T02:00:00.000Z"
    });

    const created = createFundReviewNote(
      {
        code: "161725",
        title: "半导体午后回撤复盘",
        reviewDate: "2026-03-07",
        expectation: "预计震荡",
        result: "午后回落",
        reason: "板块走弱",
        actionPlan: "下次分批减仓",
        tags: ["半导体", "回撤"]
      },
      db
    );
    expect(created.tags).toEqual(["半导体", "回撤"]);

    const updated = updateFundReviewNote(
      {
        id: created.id,
        code: "161725",
        title: "半导体弱反弹复盘",
        reviewDate: "2026-03-07",
        expectation: "预计反弹",
        result: "弱反弹",
        reason: "成交量不足",
        actionPlan: "等待确认",
        tags: ["复盘"]
      },
      db
    );
    expect(updated.result).toBe("弱反弹");

    const notes = listFundReviewNotes("161725", db);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe("半导体弱反弹复盘");
    expect(notes[0]?.expectation).toBe("预计反弹");

    const card = listFundCards({ date: "2026-03-07" }, db)[0];
    expect(card?.latestReview?.id).toBe(created.id);
  });

  it("supports decision checklist CRUD, summary, and archive to review", () => {
    const db = createIsolatedDb(":memory:");
    addWatchlistItem("161725", db);

    const created = createDecisionChecklistItem(
      {
        code: "161725",
        tradeDate: "2026-03-10",
        triggerCondition: "跌破 2.26",
        actionPlan: "减仓 20%",
        invalidCondition: "放量反包",
        reviewNote: "",
        status: "todo",
        priority: "high"
      },
      db
    );

    const list = listDecisionChecklistItems("161725", "2026-03-10", db);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);
    expect(list[0]?.status).toBe("todo");

    const summaryTodo = getDecisionSummaryByCodes(["161725"], "2026-03-10", db);
    expect(summaryTodo["161725"]?.todoCount).toBe(1);

    updateDecisionChecklistItem(
      {
        id: created.id,
        code: "161725",
        tradeDate: "2026-03-10",
        triggerCondition: "跌破 2.26",
        actionPlan: "减仓 20%",
        invalidCondition: "放量反包",
        reviewNote: "执行后回撤收窄",
        status: "done",
        priority: "high"
      },
      db
    );

    const summaryDone = getDecisionSummaryByCodes(["161725"], "2026-03-10", db);
    expect(summaryDone["161725"]?.doneCount).toBe(1);
    expect(summaryDone["161725"]?.todoCount).toBe(0);

    const notes = listFundReviewNotes("161725", db);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.result).toBe("执行后回撤收窄");

    expect(deleteDecisionChecklistItem(created.id, "161725", db)).toBe(true);
    expect(deleteDecisionChecklistItem(created.id, "161725", db)).toBe(false);
  });
});
