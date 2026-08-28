import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Refusing bids from the seller themselves, under another account.
 *
 * Shill bidding — a seller pushing up the price on their own item — is the one
 * kind of fraud an auction cannot absorb, because the winner pays a price that
 * nobody genuinely offered. `placeBid` already rejects a bid from the seller's
 * own account; this catches the same person arriving through a second one.
 *
 * The two signals are the ones the marketplace has already proved: a phone
 * number verified by SMS, and a name and date of birth checked against an ID
 * card by a human. Both are strong — someone who verified the same number on
 * two accounts, or passed KYC twice with the same identity, is the same person.
 *
 * A weaker signal (shared IP, shared device) is deliberately NOT grounds for
 * refusal here: a household shares a router, and refusing a legitimate bid is
 * worse than reviewing a suspicious one. Those go to the admin fraud page
 * instead, to be judged by a person.
 */

export type ShillLink = "phone" | "identity";

/**
 * Is the bidder provably the same person as the seller?
 *
 * Returns which signal matched, or null. Two cheap indexed queries, run before
 * the bidding transaction opens so the auction's row lock is not held across
 * them — the seller of an item never changes, so reading it beforehand is safe.
 */
export async function findShillLink(
  bidderId: string,
  sellerId: string,
): Promise<ShillLink | null> {
  if (bidderId === sellerId) return "identity";

  // A phone number verified on both accounts.
  const sellerPhones = await prisma.verifiedPhone.findMany({
    where: { userId: sellerId },
    select: { phone: true },
  });

  if (sellerPhones.length > 0) {
    const sharedPhone = await prisma.verifiedPhone.findFirst({
      where: {
        userId: bidderId,
        phone: { in: sellerPhones.map((row) => row.phone) },
      },
      select: { id: true },
    });
    if (sharedPhone) return "phone";
  }

  // The same legal identity on both accounts. Only compared when the bidder has
  // actually supplied one: two accounts that both left it blank are not a
  // match, they are simply two buyers.
  const bidder = await prisma.user.findUnique({
    where: { id: bidderId },
    select: { firstName: true, lastName: true, dateOfBirth: true },
  });
  if (!bidder?.firstName || !bidder.lastName || !bidder.dateOfBirth) {
    return null;
  }

  const sameIdentity = await prisma.user.findFirst({
    where: {
      id: sellerId,
      firstName: bidder.firstName,
      lastName: bidder.lastName,
      dateOfBirth: bidder.dateOfBirth,
    },
    select: { id: true },
  });

  return sameIdentity ? "identity" : null;
}

/** What the would-be bidder is told. */
export function shillMessage(link: ShillLink): string {
  return link === "phone"
    ? "เสนอราคาไม่ได้ เนื่องจากบัญชีนี้ใช้เบอร์โทรศัพท์เดียวกับผู้ขายสินค้าชิ้นนี้ — ผู้ขายเสนอราคาสินค้าของตัวเองไม่ได้ ไม่ว่าจะผ่านบัญชีใดก็ตาม"
    : "เสนอราคาไม่ได้ เนื่องจากข้อมูลยืนยันตัวตน (ชื่อ-นามสกุล-วันเกิด) ของบัญชีนี้ตรงกับผู้ขายสินค้าชิ้นนี้ — ผู้ขายเสนอราคาสินค้าของตัวเองไม่ได้ ไม่ว่าจะผ่านบัญชีใดก็ตาม";
}
