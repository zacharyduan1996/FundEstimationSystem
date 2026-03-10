import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { APP_TIMEZONE } from "./constants";

dayjs.extend(utc);
dayjs.extend(timezone);

export function toShanghai(value?: string | Date): dayjs.Dayjs {
  if (!value) {
    return dayjs().tz(APP_TIMEZONE);
  }

  return dayjs(value).tz(APP_TIMEZONE);
}

export function getTodayShanghai(): string {
  return toShanghai().format("YYYY-MM-DD");
}

export function formatDateParts(value: string | Date): { asOfDate: string; asOfTime: string } {
  const dt = toShanghai(value);
  return {
    asOfDate: dt.format("YYYY-MM-DD"),
    asOfTime: dt.format("HH:mm:ss")
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
