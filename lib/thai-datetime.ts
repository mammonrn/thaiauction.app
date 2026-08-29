/**
 * Thai date and time presentation.
 *
 * Native <input type="datetime-local"> renders in the browser/OS locale and
 * ignores the page entirely — verified in Chromium with locale th-TH and
 * lang="th"/"th-TH-u-ca-buddhist", which still rendered "08/28/2026, 02:30 PM":
 * Gregorian year, AM/PM, US field order. There is no attribute or CSS that
 * changes it, so anything shown to a Thai seller has to be composed here.
 *
 * Stored values remain UTC instants; only the presentation is Thai.
 */

/** พ.ศ. = ค.ศ. + 543. */
export const BE_OFFSET = 543;

export function toBuddhistYear(gregorianYear: number): number {
  return gregorianYear + BE_OFFSET;
}

export function toGregorianYear(buddhistYear: number): number {
  return buddhistYear - BE_OFFSET;
}

/**
 * Full Thai month names, taken from Intl rather than typed out, so they cannot
 * drift from the platform's own spelling.
 */
export const THAI_MONTHS: string[] = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("th-TH", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2001, month, 1)),
  ),
);

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The only timezone this marketplace displays in. */
export const THAI_TIME_ZONE = "Asia/Bangkok";

/**
 * The wall-clock reading of an instant in Bangkok.
 *
 * `getHours()` and friends answer in whatever timezone the code happens to be
 * running in. In a Server Component that is the SERVER's, and the VPS runs
 * UTC — which is how the admin pages came to show payouts and KYC submissions
 * seven hours early. Asking Intl for the Bangkok parts makes the answer the
 * same whether it is computed on the server, in a Thai buyer's browser, or in
 * one abroad: a Thai marketplace states Thai time.
 *
 * Only presentation. Stored values stay UTC instants, and the countdown clock
 * measures elapsed milliseconds, so neither is touched by this.
 */
function bangkokParts(date: Date): {
  year: number;
  monthIndex: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: THAI_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: find("year"),
    // Intl counts months from 1; THAI_MONTHS is indexed from 0.
    monthIndex: find("month") - 1,
    day: find("day"),
    // hour12:false still yields 24 for midnight on some ICU versions.
    hour: find("hour") % 24,
    minute: find("minute"),
  };
}

/** Days in a month, leap years included. */
export function daysInMonth(gregorianYear: number, monthIndex: number): number {
  return new Date(gregorianYear, monthIndex + 1, 0).getDate();
}

/**
 * "28 สิงหาคม 2569" — composed field by field rather than left to Intl's own
 * pattern, so the wording is fixed regardless of platform ICU version.
 */
export function formatThaiDate(date: Date): string {
  const { year, monthIndex, day } = bangkokParts(date);
  return `${day} ${THAI_MONTHS[monthIndex]} ${toBuddhistYear(year)}`;
}

/** "14:30 น." — always 24-hour, never AM/PM. */
export function formatThaiTime(date: Date): string {
  const { hour, minute } = bangkokParts(date);
  return `${pad2(hour)}:${pad2(minute)} น.`;
}

/** "28 สิงหาคม 2569 เวลา 14:30 น." */
export function formatThaiDateTime(date: Date): string {
  return `${formatThaiDate(date)} เวลา ${formatThaiTime(date)}`;
}

/**
 * "2026-08-28T14:30" — a datetime-local input value in Bangkok time.
 *
 * For seeding a picker from a stored instant on the SERVER, where the naive
 * `getFullYear()/getHours()` form would answer in the server's timezone and
 * put the field seven hours out on a UTC host.
 */
export function thaiDateTimeInputValue(date: Date): string {
  const { year, monthIndex, day, hour, minute } = bangkokParts(date);
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`;
}
