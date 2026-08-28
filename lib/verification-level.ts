/**
 * How far an account has got through verification.
 *
 * Replaces three separate badges that stacked up on the account page and said
 * three overlapping things. What a person actually wants to know is one fact —
 * what can I do right now, and what unlocks next — so this collapses to a
 * single level with a single next step.
 *
 * Email is not a level of its own. Better Auth only issues a session after
 * Google has confirmed the address, so every signed-in account already has it;
 * a badge for something nobody can lack tells nobody anything.
 */

export const LEVELS = {
  1: {
    label: "ระดับ 1",
    title: "มีบัญชีแล้ว",
    can: "ดูและติดตามสินค้าได้",
    next: "ยืนยันเบอร์โทรศัพท์เพื่อเริ่มเสนอราคา",
    nextHref: "/account/phone",
    nextLabel: "ยืนยันเบอร์โทรศัพท์",
  },
  2: {
    label: "ระดับ 2",
    title: "ยืนยันเบอร์โทรแล้ว",
    can: "เสนอราคาได้",
    next: "ยืนยันตัวตนเพื่อเริ่มลงขายสินค้า",
    nextHref: "/account/verification",
    nextLabel: "ยืนยันตัวตนผู้ขาย",
  },
  3: {
    label: "ระดับ 3",
    title: "ยืนยันตัวตนแล้ว",
    can: "เสนอราคาและลงขายได้",
    next: null,
    nextHref: null,
    nextLabel: null,
  },
} as const;

export type VerificationLevel = keyof typeof LEVELS;

export type VerificationFacts = {
  phoneVerified: boolean;
  identityVerified: boolean;
};

/**
 * Levels are cumulative and ordered, so the identity check alone does not make
 * someone level 3 — a seller still has to be reachable by phone. Reading it
 * any other way would let an account sell without a working number.
 */
export function verificationLevel({
  phoneVerified,
  identityVerified,
}: VerificationFacts): VerificationLevel {
  if (identityVerified && phoneVerified) return 3;
  if (phoneVerified) return 2;
  return 1;
}
