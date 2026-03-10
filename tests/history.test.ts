import { buildHistoryAnalysis, getRangeStartDate, resolveHistoryRange } from "@/lib/history";

describe("history helpers", () => {
  it("resolves history range with fallback", () => {
    expect(resolveHistoryRange("30D")).toBe("30D");
    expect(resolveHistoryRange("bad")).toBe("90D");
    expect(resolveHistoryRange(null)).toBe("90D");
  });

  it("calculates start date from range", () => {
    expect(getRangeStartDate("7D", "2026-03-06")).toBe("2026-02-28");
    expect(getRangeStartDate("1Y", "2026-03-06")).toBe("2025-03-07");
  });

  it("builds return and max drawdown metrics", () => {
    const analysis = buildHistoryAnalysis(
      "30D",
      [
        { ts: "2026-02-01T07:00:00.000Z", nav: 1, deltaPct: 0 },
        { ts: "2026-02-02T07:00:00.000Z", nav: 1.1, deltaPct: 10 },
        { ts: "2026-02-03T07:00:00.000Z", nav: 0.99, deltaPct: -1 },
        { ts: "2026-02-04T07:00:00.000Z", nav: 1.2, deltaPct: 20 }
      ],
      false
    );

    expect(analysis.returnPct).toBe(20);
    expect(analysis.maxDrawdownPct).toBe(-10);
    expect(analysis.periodHigh?.nav).toBe(1.2);
    expect(analysis.periodLow?.nav).toBe(0.99);
    expect(analysis.updatedAt).toBe("2026-02-04T07:00:00.000Z");
    expect(analysis.fromCache).toBe(false);
  });
});

