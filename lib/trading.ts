import { toShanghai } from "./time";
import { STALE_AFTER_MS } from "./constants";
import { isTradingDay } from "./calendar";

function inRange(hhmm: number, start: number, end: number): boolean {
  return hhmm >= start && hhmm <= end;
}

export function isTradingTime(date: Date = new Date()): boolean {
  if (!isTradingDay(date)) {
    return false;
  }

  const now = toShanghai(date);
  const hhmm = Number(now.format("HHmm"));
  return inRange(hhmm, 930, 1130) || inRange(hhmm, 1300, 1500);
}

export function isStale(quoteTs: string | null, now: Date = new Date()): boolean {
  if (!quoteTs) {
    return true;
  }

  const diff = now.getTime() - new Date(quoteTs).getTime();
  return diff > STALE_AFTER_MS;
}
