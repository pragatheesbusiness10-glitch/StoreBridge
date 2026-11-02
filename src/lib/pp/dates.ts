import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfISOWeek,
  startOfMonth,
} from "date-fns";

/** All Prime Physique dates are local calendar dates stored as `yyyy-MM-dd`. */
export type DateStr = string;

export const toDateStr = (d: Date): DateStr => format(d, "yyyy-MM-dd");
export const todayStr = (): DateStr => toDateStr(new Date());
export const parseDate = (s: DateStr): Date => parseISO(s);
export const addDaysStr = (s: DateStr, n: number): DateStr => toDateStr(addDays(parseISO(s), n));
export const daysBetween = (from: DateStr, to: DateStr): number =>
  differenceInCalendarDays(parseISO(to), parseISO(from));
export const weekStartStr = (s: DateStr): DateStr => toDateStr(startOfISOWeek(parseISO(s)));
export const monthStartStr = (s: DateStr): DateStr => toDateStr(startOfMonth(parseISO(s)));
/** ISO weekday: 1 = Monday … 7 = Sunday */
export const isoWeekday = (s: DateStr): number => {
  const d = parseISO(s).getDay();
  return d === 0 ? 7 : d;
};

export function eachDay(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDaysStr(from, i));
  return out;
}

export const fmtDate = (s: DateStr | null | undefined, pattern = "d MMM yyyy") =>
  s ? format(parseISO(s), pattern) : "—";
export const fmtShort = (s: DateStr) => format(parseISO(s), "d MMM");

export const WEEKDAYS = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export type RangePreset = "7" | "14" | "30" | "90" | "custom";
export type DateRange = { from: DateStr; to: DateStr };

export function presetRange(
  preset: Exclude<RangePreset, "custom">,
  end: DateStr = todayStr(),
): DateRange {
  return { from: addDaysStr(end, -(Number(preset) - 1)), to: end };
}

export const nowTimeStr = () => format(new Date(), "HH:mm");
