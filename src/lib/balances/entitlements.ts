import { differenceInCalendarDays, differenceInMonths, differenceInYears, parseISO } from "date-fns";

function avgDailyHours(scheduledHoursPerWeek: number): number {
  return scheduledHoursPerWeek / 5;
}

function vacationTierDays(anniversaryDate: Date, asOf: Date): number {
  const months = differenceInMonths(asOf, anniversaryDate);
  if (months < 6) return 0;
  const years = differenceInYears(asOf, anniversaryDate);
  if (years < 1) return 5;
  if (years < 4) return 10;
  if (years < 6) return 15;
  return 20;
}

function personalTierDays(anniversaryDate: Date, asOf: Date): number {
  const days = differenceInCalendarDays(asOf, anniversaryDate);
  if (days < 90) return 0;
  const months = differenceInMonths(asOf, anniversaryDate);
  if (months < 6) return 4;
  return 9;
}

export function computeVacationEntitlement(
  anniversaryDateISO: string,
  asOfISO: string,
  scheduledHoursPerWeek: number,
): number {
  const anniversary = parseISO(anniversaryDateISO);
  const asOf = parseISO(asOfISO);
  const days = vacationTierDays(anniversary, asOf);
  return days * avgDailyHours(scheduledHoursPerWeek);
}

export function computePersonalEntitlement(
  anniversaryDateISO: string,
  asOfISO: string,
  scheduledHoursPerWeek: number,
): number {
  const anniversary = parseISO(anniversaryDateISO);
  const asOf = parseISO(asOfISO);
  const days = personalTierDays(anniversary, asOf);
  return days * avgDailyHours(scheduledHoursPerWeek);
}
