import { isChinaPublicHoliday, isTradingDay } from "@/lib/calendar";

describe("china trading calendar", () => {
  it("treats public holiday as non-trading day", () => {
    expect(isChinaPublicHoliday(new Date("2026-10-01T02:00:00.000Z"))).toBe(true);
    expect(isTradingDay(new Date("2026-10-01T02:00:00.000Z"))).toBe(false);
  });

  it("keeps regular weekday as trading day", () => {
    expect(isChinaPublicHoliday(new Date("2026-03-04T02:00:00.000Z"))).toBe(false);
    expect(isTradingDay(new Date("2026-03-04T02:00:00.000Z"))).toBe(true);
  });
});
