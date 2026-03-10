import { parseEastMoneyJsonp } from "@/lib/provider/eastmoney";

describe("eastmoney parser", () => {
  it("maps payload fields into FundEstimationSourceRecord", () => {
    const payload =
      'jsonpgz({"fundcode":"161725","name":"招商中证白酒指数(LOF)A","jzrq":"2026-03-05","dwjz":"0.9123","gsz":"0.9188","gszzl":"0.71","gztime":"2026-03-06 10:31"});';

    const result = parseEastMoneyJsonp(payload);

    expect(result.code).toBe("161725");
    expect(result.name).toBe("招商中证白酒指数(LOF)A");
    expect(result.nav).toBe(0.9123);
    expect(result.estimatedNav).toBe(0.9188);
    expect(result.deltaPercent).toBe(0.71);
    expect(result.asOf).toContain("2026-03-06T");
    expect(result.instrumentType).toBe("lof");
    expect(result.source).toBe("eastmoney_estimation");
  });
});
