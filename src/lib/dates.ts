import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import {
  addDays,
  format,
  getDay,
  isValid,
  parse,
} from "date-fns";

export const APP_TIMEZONE = "America/New_York";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):(00|15|30|45)$/;

export function isISODateString(value: string): boolean {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const d = parse(value, "yyyy-MM-dd", new Date());
  return isValid(d) && format(d, "yyyy-MM-dd") === value;
}

export function isMondayISODate(value: string): boolean {
  if (!isISODateString(value)) return false;
  // Day-of-week in ET wall clock.
  const dEt = toZonedTime(parse(value, "yyyy-MM-dd", new Date()), APP_TIMEZONE);
  return getDay(dEt) === 1; // 0=Sun, 1=Mon
}

export function timeToMinutes(value: string): number {
  if (typeof value !== "string" || !TIME_RE.test(value)) return NaN;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function assertTimeRange(start: string, end: string): void {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (Number.isNaN(s) || Number.isNaN(e)) {
    throw new Error(`Invalid time(s): ${start}, ${end}`);
  }
  if (s >= e) {
    throw new Error(`start (${start}) must be strictly less than end (${end})`);
  }
}

export function todayET(): string {
  return formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd");
}

export function weekStartOf(isoDate: string): string {
  if (!isISODateString(isoDate)) {
    throw new Error(`Not an ISO date: ${isoDate}`);
  }
  // Treat the date as ET wall-clock; find the Monday of its week.
  const d = toZonedTime(parse(isoDate, "yyyy-MM-dd", new Date()), APP_TIMEZONE);
  const dow = getDay(d); // 0=Sun..6=Sat
  const daysToSubtract = dow === 0 ? 6 : dow - 1;
  return formatInTimeZone(
    addDays(d, -daysToSubtract),
    APP_TIMEZONE,
    "yyyy-MM-dd",
  );
}

export function weekEnd(weekStartISO: string): string {
  return addDaysISO(weekStartISO, 4); // Mon → Fri
}

export function addDaysISO(isoDate: string, days: number): string {
  if (!isISODateString(isoDate)) {
    throw new Error(`Not an ISO date: ${isoDate}`);
  }
  const d = parse(isoDate, "yyyy-MM-dd", new Date());
  return format(addDays(d, days), "yyyy-MM-dd");
}

export function daysInRange(startISO: string, endISO: string): string[] {
  if (!isISODateString(startISO) || !isISODateString(endISO)) {
    throw new Error(`Invalid date range: ${startISO} to ${endISO}`);
  }
  const out: string[] = [];
  let cur = startISO;
  while (cur <= endISO) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}
