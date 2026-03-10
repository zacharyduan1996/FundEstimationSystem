import { toShanghai } from "./time";
import type { FundHistoryAnalysis, HistoryPoint, HistoryRange } from "./types";

export const DEFAULT_HISTORY_RANGE: HistoryRange = "90D";

const HISTORY_RANGE_DAYS: Record<HistoryRange, number> = {
  "7D": 7,
  "30D": 30,
  "90D": 90,
  "180D": 180,
  "1Y": 365
};

export function resolveHistoryRange(input: string | null | undefined): HistoryRange {
  if (input === "7D" || input === "30D" || input === "90D" || input === "180D" || input === "1Y") {
    return input;
  }

  return DEFAULT_HISTORY_RANGE;
}

export function getRangeStartDate(range: HistoryRange, endDate?: string): string {
  const end = toShanghai(endDate);
  return end.subtract(HISTORY_RANGE_DAYS[range] - 1, "day").format("YYYY-MM-DD");
}

function round(value: number, digits: number): number {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

export function buildHistoryAnalysis(
  range: HistoryRange,
  points: HistoryPoint[],
  fromCache: boolean
): FundHistoryAnalysis {
  const sorted = [...points].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (!first || !last) {
    return {
      range,
      points: [],
      returnPct: null,
      maxDrawdownPct: null,
      periodHigh: null,
      periodLow: null,
      updatedAt: null,
      fromCache
    };
  }

  let runningPeak = first.nav;
  let worstDrawdown = 0;
  let periodHigh = first;
  let periodLow = first;

  for (const point of sorted) {
    if (point.nav > runningPeak) {
      runningPeak = point.nav;
    }

    if (runningPeak > 0) {
      const drawdown = ((point.nav - runningPeak) / runningPeak) * 100;
      if (drawdown < worstDrawdown) {
        worstDrawdown = drawdown;
      }
    }

    if (point.nav > periodHigh.nav) {
      periodHigh = point;
    }

    if (point.nav < periodLow.nav) {
      periodLow = point;
    }
  }

  const returnPct = first.nav > 0 ? ((last.nav - first.nav) / first.nav) * 100 : 0;

  return {
    range,
    points: sorted,
    returnPct: round(returnPct, 2),
    maxDrawdownPct: round(worstDrawdown, 2),
    periodHigh: { nav: periodHigh.nav, ts: periodHigh.ts },
    periodLow: { nav: periodLow.nav, ts: periodLow.ts },
    updatedAt: last.ts,
    fromCache
  };
}

