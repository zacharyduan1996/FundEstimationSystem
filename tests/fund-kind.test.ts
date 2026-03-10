import { detectFundInstrumentType, resolveEastMoneySecid } from "@/lib/fund-kind";

describe("fund instrument detection", () => {
  it("detects open fund / ETF / LOF", () => {
    expect(detectFundInstrumentType("110011")).toBe("open_fund");
    expect(detectFundInstrumentType("513050")).toBe("etf");
    expect(detectFundInstrumentType("161725")).toBe("lof");
  });

  it("maps code to eastmoney secid", () => {
    expect(resolveEastMoneySecid("513050")).toBe("1.513050");
    expect(resolveEastMoneySecid("161725")).toBe("0.161725");
  });
});
