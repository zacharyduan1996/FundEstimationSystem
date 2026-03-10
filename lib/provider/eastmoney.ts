import { z } from "zod";
import { detectFundInstrumentType, resolveEastMoneySecid } from "../fund-kind";
import { formatDateParts, getTodayShanghai, toShanghai } from "../time";
import type { FundEstimationSourceRecord, FundInstrumentType, TrendPoint } from "../types";

const estimationPayloadSchema = z.object({
  fundcode: z.string(),
  name: z.string(),
  dwjz: z.string(),
  gsz: z.string(),
  gszzl: z.string(),
  gztime: z.string()
});

const ESTIMATION_ENDPOINT = "https://fundgz.1234567.com.cn/js";
const TRENDS2_ENDPOINT = "https://push2his.eastmoney.com/api/qt/stock/trends2/get";

export function parseEastMoneyJsonp(input: string): FundEstimationSourceRecord {
  const matched = input.match(/jsonpgz\((.*)\);?/);
  if (!matched || matched[1] === undefined) {
    throw new Error("Invalid EastMoney JSONP response");
  }

  if (matched[1].trim() === "") {
    throw new Error("Empty estimation payload");
  }

  const parsed = estimationPayloadSchema.parse(JSON.parse(matched[1]));
  const nav = Number(parsed.dwjz);
  const estimatedNav = Number(parsed.gsz);
  const deltaPercent = Number(parsed.gszzl);

  if ([nav, estimatedNav, deltaPercent].some((n) => Number.isNaN(n))) {
    throw new Error("Invalid numeric fields in EastMoney response");
  }

  const ts = toShanghai(parsed.gztime);
  const asOf = ts.isValid() ? ts.toISOString() : new Date().toISOString();

  return {
    code: parsed.fundcode,
    name: parsed.name,
    nav,
    estimatedNav,
    deltaPercent,
    asOf,
    instrumentType: detectFundInstrumentType(parsed.fundcode),
    source: "eastmoney_estimation"
  };
}

export async function fetchFundEstimation(code: string): Promise<FundEstimationSourceRecord> {
  const url = `${ESTIMATION_ENDPOINT}/${code}.js?rt=${Date.now()}`;
  const response = await fetch(url, {
    headers: {
      Referer: "https://fund.eastmoney.com/"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`EastMoney request failed: ${response.status}`);
  }

  const text = await response.text();
  const record = parseEastMoneyJsonp(text);
  const { asOfDate, asOfTime } = formatDateParts(record.asOf);

  return {
    ...record,
    asOf: `${asOfDate}T${asOfTime}+08:00`
  };
}

function parseTrendLine(line: string, preClose: number): TrendPoint {
  const parts = line.split(",");
  if (parts.length < 3) {
    throw new Error("Invalid trend row");
  }

  const ts = toShanghai(parts[0]).toISOString();
  const close = Number(parts[2]);
  if (Number.isNaN(close)) {
    throw new Error("Invalid close price in trend row");
  }

  const deltaPercent = preClose > 0 ? ((close - preClose) / preClose) * 100 : 0;

  return {
    ts,
    estimatedNav: close,
    deltaPercent: Number(deltaPercent.toFixed(4))
  };
}

export async function fetchFundMinuteTrend(code: string): Promise<{
  record: FundEstimationSourceRecord;
  trendPoints: TrendPoint[];
}> {
  const secid = resolveEastMoneySecid(code);
  const url = `${TRENDS2_ENDPOINT}?fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ut=fa5fd1943c7b386f172d6893dbfba10b&iscr=0&ndays=1&secid=${secid}&_=${Date.now()}`;

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`EastMoney trends2 failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    rc: number;
    data: {
      code: string;
      name: string;
      preClose: number;
      preSettlement?: number;
      trends?: string[];
    } | null;
  };

  if (payload.rc !== 0 || !payload.data?.trends || payload.data.trends.length === 0) {
    throw new Error("No minute trend data");
  }

  const preCloseRaw = Number(payload.data.preClose ?? payload.data.preSettlement ?? 0);
  const preClose = Number.isNaN(preCloseRaw) || preCloseRaw <= 0 ? 0 : preCloseRaw;

  const trendPoints = payload.data.trends.map((row) => parseTrendLine(row, preClose));
  const latest = trendPoints[trendPoints.length - 1];
  if (!latest) {
    throw new Error("No latest trend point");
  }

  const instrumentType = detectFundInstrumentType(code);
  const nav = preClose > 0 ? preClose : latest.estimatedNav;

  return {
    record: {
      code,
      name: payload.data.name,
      nav,
      estimatedNav: latest.estimatedNav,
      deltaPercent: latest.deltaPercent,
      asOf: latest.ts,
      instrumentType,
      source: "eastmoney_trends2"
    },
    trendPoints
  };
}

function shouldPreferMinuteSource(instrumentType: FundInstrumentType): boolean {
  return instrumentType === "etf" || instrumentType === "lof";
}

export async function fetchFundSnapshotWithStrategy(code: string): Promise<FundEstimationSourceRecord> {
  const instrumentType = detectFundInstrumentType(code);

  if (shouldPreferMinuteSource(instrumentType)) {
    try {
      const minute = await fetchFundMinuteTrend(code);
      return minute.record;
    } catch {
      return fetchFundEstimation(code);
    }
  }

  try {
    return await fetchFundEstimation(code);
  } catch {
    const minute = await fetchFundMinuteTrend(code);
    return minute.record;
  }
}

export async function fetchRealtimeTrendIfAvailable(code: string, date: string): Promise<TrendPoint[] | null> {
  if (date !== getTodayShanghai()) {
    return null;
  }

  const instrumentType = detectFundInstrumentType(code);
  if (!shouldPreferMinuteSource(instrumentType)) {
    return null;
  }

  try {
    const minute = await fetchFundMinuteTrend(code);
    return minute.trendPoints;
  } catch {
    return null;
  }
}
