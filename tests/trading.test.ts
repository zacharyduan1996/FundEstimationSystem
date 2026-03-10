import { isStale, isTradingTime } from "@/lib/trading";

describe("trading windows", () => {
  it("recognizes Shanghai market trading hours", () => {
    expect(isTradingTime(new Date("2026-03-06T01:45:00.000Z"))).toBe(true); // 09:45 CST
    expect(isTradingTime(new Date("2026-03-06T04:00:00.000Z"))).toBe(false); // 12:00 CST
    expect(isTradingTime(new Date("2026-03-07T02:00:00.000Z"))).toBe(false); // Saturday
    expect(isTradingTime(new Date("2026-10-01T01:45:00.000Z"))).toBe(false); // National Day
  });

  it("marks stale after 180 seconds", () => {
    const now = new Date("2026-03-06T02:00:00.000Z");
    expect(isStale("2026-03-06T01:57:10.000Z", now)).toBe(false);
    expect(isStale("2026-03-06T01:56:50.000Z", now)).toBe(true);
  });
});
