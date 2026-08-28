/**
 * Thai banks a seller can be paid into.
 *
 * A fixed list rather than free text so the payout screen shows a consistent
 * name and an admin is never guessing which bank "กสิกร" means. Codes are this
 * project's own short identifiers, not SWIFT or BOT codes — nothing is
 * submitted to a banking API, so they only have to be stable and readable.
 */
export const THAI_BANKS = [
  { code: "bbl", name: "ธนาคารกรุงเทพ" },
  { code: "kbank", name: "ธนาคารกสิกรไทย" },
  { code: "ktb", name: "ธนาคารกรุงไทย" },
  { code: "bay", name: "ธนาคารกรุงศรีอยุธยา" },
  { code: "scb", name: "ธนาคารไทยพาณิชย์" },
  { code: "ttb", name: "ธนาคารทหารไทยธนชาต" },
  { code: "gsb", name: "ธนาคารออมสิน" },
  { code: "baac", name: "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร" },
  { code: "uob", name: "ธนาคารยูโอบี" },
  { code: "cimb", name: "ธนาคารซีไอเอ็มบี ไทย" },
  { code: "lhbank", name: "ธนาคารแลนด์ แอนด์ เฮ้าส์" },
  { code: "kkp", name: "ธนาคารเกียรตินาคินภัทร" },
  { code: "ghb", name: "ธนาคารอาคารสงเคราะห์" },
  { code: "ibank", name: "ธนาคารอิสลามแห่งประเทศไทย" },
] as const;

export type ThaiBankCode = (typeof THAI_BANKS)[number]["code"];

export function bankName(code: string): string {
  return THAI_BANKS.find((bank) => bank.code === code)?.name ?? code;
}

export function isThaiBankCode(code: string): boolean {
  return THAI_BANKS.some((bank) => bank.code === code);
}

/** Thai account numbers run 10–15 digits depending on the bank. */
export function normaliseAccountNumber(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export type BankAccountInput = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
};

export type BankAccountErrors = Partial<Record<keyof BankAccountInput, string>>;

export function validateBankAccount(
  input: BankAccountInput,
): BankAccountErrors {
  const errors: BankAccountErrors = {};

  if (!isThaiBankCode(input.bankCode)) {
    errors.bankCode = "กรุณาเลือกธนาคาร";
  }

  const number = normaliseAccountNumber(input.accountNumber);
  if (!/^\d{10,15}$/.test(number)) {
    errors.accountNumber = "เลขบัญชีต้องเป็นตัวเลข 10–15 หลัก";
  }

  const name = input.accountName.trim();
  if (!name) {
    errors.accountName = "กรุณากรอกชื่อบัญชี";
  } else if (name.length > 100) {
    errors.accountName = "ชื่อบัญชีต้องไม่เกิน 100 ตัวอักษร";
  }

  return errors;
}
