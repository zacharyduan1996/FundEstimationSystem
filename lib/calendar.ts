import Holidays from "date-holidays";
import { APP_TIMEZONE } from "./constants";
import { toShanghai } from "./time";

const cnHolidays = new Holidays("CN");

export function isChinaPublicHoliday(date: Date = new Date()): boolean {
  const localDate = toShanghai(date).tz(APP_TIMEZONE, true).toDate();
  return Boolean(cnHolidays.isHoliday(localDate));
}

export function isTradingDay(date: Date = new Date()): boolean {
  const local = toShanghai(date);
  const weekday = local.day();

  if (weekday === 0 || weekday === 6) {
    return false;
  }

  return !isChinaPublicHoliday(local.toDate());
}
