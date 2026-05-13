import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

export const APP_TIMEZONE = "America/New_York";

export function formatInAppTz(date: Date | number | string, fmt: string) {
  return formatInTimeZone(date, APP_TIMEZONE, fmt);
}

export function toAppTz(date: Date | number | string) {
  return toZonedTime(date, APP_TIMEZONE);
}

export function fromAppTz(date: Date) {
  return fromZonedTime(date, APP_TIMEZONE);
}
