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

/** Days in a month, leap years included. */
export function daysInMonth(gregorianYear: number, monthIndex: number): number {
  return new Date(gregorianYear, monthIndex + 1, 0).getDate();
}

/**
 * "28 สิงหาคม 2569" — composed field by field rather than left to Intl's own
 * pattern, so the wording is fixed regardless of platform ICU version.
 */
export function formatThaiDate(date: Date): string {
  return `${date.getDate()} ${THAI_MONTHS[date.getMonth()]} ${toBuddhistYear(
    date.getFullYear(),
  )}`;
}

/** "14:30 น." — always 24-hour, never AM/PM. */
export function formatThaiTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())} น.`;
}

/** "28 สิงหาคม 2569 เวลา 14:30 น." */
export function formatThaiDateTime(date: Date): string {
  return `${formatThaiDate(date)} เวลา ${formatThaiTime(date)}`;
}
