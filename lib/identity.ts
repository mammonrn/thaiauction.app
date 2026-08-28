/**
 * Legal identity supplied by a seller before an ID document is reviewed.
 *
 * No "use client"/"use server" directive: the same rules run in the browser for
 * feedback and on the server, where they are enforced.
 */

export const MAX_NAME_LENGTH = 100;
/** Sellers must be adults; see `ageOn` for why this is checked at submission. */
export const MIN_SELLER_AGE = 18;

export type IdentityInput = {
  firstName: string;
  lastName: string;
  /** "YYYY-MM-DD" as typed. */
  dateOfBirth: string;
};

export type IdentityErrors = Partial<Record<keyof IdentityInput, string>>;

/**
 * Parse "YYYY-MM-DD" into a UTC-midnight Date.
 *
 * Built with Date.UTC rather than `new Date(string)` so the value is the same
 * calendar day everywhere: parsing a bare date string yields UTC midnight,
 * which in Bangkok (UTC+7) still renders as the intended day, but building it
 * from local parts would not survive a server in a negative offset.
 */
export function parseDateOfBirth(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible dates that would otherwise roll over, e.g. 31 Feb.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

/**
 * Completed years of age on a given day.
 *
 * Counts whole years: someone whose birthday is later this year is still the
 * younger age, which is what "อายุ 18 ปีบริบูรณ์" means.
 */
export function ageOn(dateOfBirth: Date, on: Date): number {
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear();

  const monthDiff = on.getUTCMonth() - dateOfBirth.getUTCMonth();
  const dayDiff = on.getUTCDate() - dateOfBirth.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;

  return age;
}

/** Format a stored date of birth as a Thai date, without timezone drift. */
export function dateOfBirthInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function validateIdentity(
  raw: IdentityInput,
  now: Date = new Date(),
): { ok: true; value: { firstName: string; lastName: string; dateOfBirth: Date } } | { ok: false; errors: IdentityErrors } {
  const errors: IdentityErrors = {};

  const clean = (v: string) => v.trim().replace(/\s+/g, " ");
  const firstName = clean(raw.firstName);
  const lastName = clean(raw.lastName);

  if (!firstName) errors.firstName = "กรุณากรอกชื่อจริง";
  else if (firstName.length > MAX_NAME_LENGTH)
    errors.firstName = `ชื่อต้องไม่เกิน ${MAX_NAME_LENGTH} ตัวอักษร`;

  if (!lastName) errors.lastName = "กรุณากรอกนามสกุล";
  else if (lastName.length > MAX_NAME_LENGTH)
    errors.lastName = `นามสกุลต้องไม่เกิน ${MAX_NAME_LENGTH} ตัวอักษร`;

  const dob = parseDateOfBirth(raw.dateOfBirth);
  if (!dob) {
    errors.dateOfBirth = "กรุณาเลือกวันเกิดให้ถูกต้อง";
  } else if (dob.getTime() > now.getTime()) {
    errors.dateOfBirth = "วันเกิดต้องไม่ใช่วันที่ในอนาคต";
  } else {
    const age = ageOn(dob, now);
    if (age < MIN_SELLER_AGE) {
      // Spelled out rather than a bare "invalid": someone refused for their age
      // should understand it is a rule about selling, not a typo in the form.
      errors.dateOfBirth =
        `ผู้ขายต้องมีอายุ ${MIN_SELLER_AGE} ปีบริบูรณ์ขึ้นไปจึงจะยืนยันตัวตนได้ ` +
        `(ตามข้อมูลที่กรอก คุณอายุ ${age} ปี) — ` +
        `การซื้อและเสนอราคายังใช้งานได้ตามปกติ`;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value: { firstName, lastName, dateOfBirth: dob! } };
}
