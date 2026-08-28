import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Strikes for not paying.
 *
 * A strike is recorded when someone wins an auction and lets the payment
 * deadline pass. Three of them removes the right to BID — nothing else. A
 * struck-out user can still sign in, browse, and sell; the sanction is aimed at
 * the specific harm they caused, which is taking an auction off the market and
 * then not paying for it.
 *
 * Derived by counting rows rather than kept as a column on `users`, for the
 * same reason seller verification is: one source of truth, and no counter that
 * can drift away from the events it is supposed to summarise.
 */

/** Strikes tolerated before bidding is withdrawn. The third strike bans. */
export const STRIKE_LIMIT = 3;

export async function countStrikes(userId: string): Promise<number> {
  return prisma.paymentStrike.count({ where: { userId } });
}

export async function isBiddingBanned(userId: string): Promise<boolean> {
  return (await countStrikes(userId)) >= STRIKE_LIMIT;
}

/** Explains the ban to the person it applies to. */
export function banMessage(strikes: number): string {
  return (
    `บัญชีของคุณถูกระงับสิทธิ์การเสนอราคา เนื่องจากไม่ชำระเงินตามกำหนด ${strikes} ครั้ง ` +
    `— คุณยังเข้าใช้งาน ดูสินค้า และลงขายสินค้าได้ตามปกติ ` +
    `หากคิดว่าเป็นความผิดพลาด กรุณาติดต่อทีมงาน`
  );
}

/**
 * Strike counts for several people at once.
 *
 * Used where a list is being rendered — the seller looking at who has bid on
 * their item, or an admin reviewing a ring — so the page does not fire one
 * query per row.
 */
export async function countStrikesFor(
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const grouped = await prisma.paymentStrike.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds } },
    _count: { userId: true },
  });

  return new Map(grouped.map((row) => [row.userId, row._count.userId]));
}
