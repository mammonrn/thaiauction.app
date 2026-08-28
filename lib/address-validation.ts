/**
 * Validation shared by the Server Actions and the client form.
 *
 * Kept in one module (no "use server"/"use client" directive) so the exact same
 * rules run in the browser for fast feedback AND on the server, where they are
 * actually enforced. Client-side checks are a convenience only — the browser
 * can skip them entirely, so the Server Action never trusts them.
 */

export const ADDRESS_FIELD_MAX = {
  recipientName: 120,
  phone: 20,
  addressLine: 300,
  subDistrict: 100,
  district: 100,
  province: 100,
} as const;

export type AddressInput = {
  recipientName: string;
  phone: string;
  addressLine: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
};

export type FieldErrors = Partial<Record<keyof AddressInput, string>>;

/**
 * Strip formatting people actually type: spaces, hyphens, dots, parentheses,
 * and the +66 / 0066 international prefixes (which replace the leading 0).
 */
export function normalisePhone(raw: string): string {
  let digits = raw.replace(/[\s\-().]/g, "");

  if (digits.startsWith("+66")) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.startsWith("0066")) {
    digits = `0${digits.slice(4)}`;
  } else if (digits.startsWith("66") && digits.length === 11) {
    digits = `0${digits.slice(2)}`;
  }

  return digits;
}

/**
 * Thai phone numbers in real use:
 *   mobile   0[6,8,9] + 8 digits  -> 10 digits total (e.g. 0812345678)
 *   landline 0[2-7]   + 7 digits  ->  9 digits total (e.g. 021234567 Bangkok,
 *                                     038123456 Chonburi)
 * Numbers are stored normalised, so lookups and duplicate checks are stable.
 */
export function isValidThaiPhone(normalised: string): boolean {
  return /^0[689]\d{8}$/.test(normalised) || /^0[2-7]\d{7}$/.test(normalised);
}

/**
 * Thai postal codes are exactly 5 digits and never start with 0
 * (the real range runs from 10000 upwards).
 */
export function isValidThaiPostalCode(value: string): boolean {
  return /^[1-9]\d{4}$/.test(value);
}

/**
 * Validate and normalise one address.
 *
 * Returns the cleaned values on success, or per-field Thai error messages.
 * Every string is trimmed, and internal runs of whitespace are collapsed, so a
 * stray double space never creates a "different" address.
 */
export function validateAddress(
  raw: Record<keyof AddressInput, string>,
): { ok: true; value: AddressInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  const clean = (v: string) => v.trim().replace(/\s+/g, " ");

  const recipientName = clean(raw.recipientName);
  const addressLine = clean(raw.addressLine);
  const subDistrict = clean(raw.subDistrict);
  const district = clean(raw.district);
  const province = clean(raw.province);
  const postalCode = raw.postalCode.trim();
  const phone = normalisePhone(raw.phone);

  if (!recipientName) {
    errors.recipientName = "กรุณากรอกชื่อผู้รับ";
  } else if (recipientName.length > ADDRESS_FIELD_MAX.recipientName) {
    errors.recipientName = `ชื่อผู้รับต้องไม่เกิน ${ADDRESS_FIELD_MAX.recipientName} ตัวอักษร`;
  }

  if (!phone) {
    errors.phone = "กรุณากรอกเบอร์โทรศัพท์";
  } else if (!isValidThaiPhone(phone)) {
    errors.phone =
      "เบอร์โทรไม่ถูกต้อง (มือถือ 10 หลักขึ้นต้น 06/08/09 หรือเบอร์บ้าน 9 หลักขึ้นต้น 02-07)";
  }

  if (!addressLine) {
    errors.addressLine = "กรุณากรอกที่อยู่ (บ้านเลขที่ ถนน)";
  } else if (addressLine.length > ADDRESS_FIELD_MAX.addressLine) {
    errors.addressLine = `ที่อยู่ต้องไม่เกิน ${ADDRESS_FIELD_MAX.addressLine} ตัวอักษร`;
  }

  if (!subDistrict) {
    errors.subDistrict = "กรุณากรอกตำบล/แขวง";
  } else if (subDistrict.length > ADDRESS_FIELD_MAX.subDistrict) {
    errors.subDistrict = `ตำบล/แขวงต้องไม่เกิน ${ADDRESS_FIELD_MAX.subDistrict} ตัวอักษร`;
  }

  if (!district) {
    errors.district = "กรุณากรอกอำเภอ/เขต";
  } else if (district.length > ADDRESS_FIELD_MAX.district) {
    errors.district = `อำเภอ/เขตต้องไม่เกิน ${ADDRESS_FIELD_MAX.district} ตัวอักษร`;
  }

  if (!province) {
    errors.province = "กรุณากรอกจังหวัด";
  } else if (province.length > ADDRESS_FIELD_MAX.province) {
    errors.province = `จังหวัดต้องไม่เกิน ${ADDRESS_FIELD_MAX.province} ตัวอักษร`;
  }

  if (!postalCode) {
    errors.postalCode = "กรุณากรอกรหัสไปรษณีย์";
  } else if (!isValidThaiPostalCode(postalCode)) {
    errors.postalCode = "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      recipientName,
      phone,
      addressLine,
      subDistrict,
      district,
      province,
      postalCode,
    },
  };
}
