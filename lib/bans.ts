import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Admin-issued, time-boxed bans.
 *
 * Deliberately a separate system from strikes, and nothing here reads or
 * writes a PaymentStrike. The two answer different questions:
 *
 *   strikes — automatic, permanent, earned by missing payment deadlines. Three
 *             and you cannot bid, for good. lib/bidding.ts owns them.
 *   bans    — a person's decision, with a reason and an end date, applied to a
 *             specific ability.
 *
 * Mixing them would mean an admin's judgement quietly changing a number the
 * payment sweep also writes, or a missed deadline reading as a moderator's
 * decision. They stay apart, and lib/bidding.ts keeps counting strikes exactly
 * as it did.
 *
 * A ban ENDS BY ITSELF. Expiry is `expiresAt` being in the past, so nothing
 * has to run for someone to get their account back — no sweep, no cron, no
 * admin remembering. Rows are never deleted when a ban lapses, so the history
 * an admin reads stays complete.
 */

export type BanKind = "login" | "bidding";

/** The lengths an admin can pick, in days. Null is permanent. */
export const BAN_DURATIONS = [1, 3, 7, 30] as const;
export type BanDuration = (typeof BAN_DURATIONS)[number] | "permanent";

export function banExpiry(duration: BanDuration, from: Date): Date | null {
  if (duration === "permanent") return null;
  return new Date(from.getTime() + duration * 24 * 60 * 60 * 1000);
}

export type ActiveBan = {
  id: string;
  kind: BanKind;
  reason: string;
  expiresAt: Date | null;
};

/**
 * The ban of this kind currently in force, or null.
 *
 * "In force" is: not lifted early, and either permanent or not yet expired.
 * Evaluated in the query rather than in JS so a lapsed ban cannot be reported
 * as active by a stale read.
 *
 * The longest-running one wins when several overlap — permanent first, then
 * the latest expiry — so stacking a short ban on top of a long one cannot
 * shorten it.
 */
export async function activeBan(
  userId: string,
  kind: BanKind,
): Promise<ActiveBan | null> {
  const now = new Date();
  const bans = await prisma.userBan.findMany({
    where: {
      userId,
      kind,
      liftedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true, kind: true, reason: true, expiresAt: true },
    // Nulls last on a descending sort would put permanent bans at the end, so
    // they are pulled to the front explicitly below.
    orderBy: { expiresAt: "desc" },
  });

  if (bans.length === 0) return null;
  const permanent = bans.find((ban) => ban.expiresAt === null);
  return (permanent ?? bans[0]) as ActiveBan;
}

/** Whether this account may sign in at all. */
export async function loginBan(userId: string): Promise<ActiveBan | null> {
  return activeBan(userId, "login");
}

/**
 * Whether this account may bid or buy outright.
 *
 * A login ban implies a bidding ban — someone who cannot sign in certainly
 * cannot bid — but they are stored separately so an admin who lifts the login
 * ban does not accidentally hand back bidding as well.
 */
export async function biddingBan(userId: string): Promise<ActiveBan | null> {
  return (await activeBan(userId, "bidding")) ?? (await activeBan(userId, "login"));
}

/** Every ban ever applied to this account, newest first, for the admin view. */
export async function banHistory(userId: string) {
  return prisma.userBan.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      kind: true,
      reason: true,
      expiresAt: true,
      liftedAt: true,
      createdAt: true,
      bannedBy: { select: { name: true, email: true } },
    },
  });
}

export type IssueBanResult =
  | { ok: true; banId: string }
  | { ok: false; reason: "not_found" | "no_reason" | "self" };

/**
 * Apply a ban.
 *
 * The reason is required, not decorative: it is what the banned person is told
 * and what the next admin reads when deciding whether to lift it. A ban with
 * no stated reason is one nobody can review.
 */
export async function issueBan(params: {
  userId: string;
  kind: BanKind;
  reason: string;
  duration: BanDuration;
  bannedById: string;
}): Promise<IssueBanResult> {
  const reason = params.reason.trim();
  if (!reason) return { ok: false, reason: "no_reason" };

  // An admin locking themselves out helps nobody and is almost always a
  // misclick on the wrong row.
  if (params.userId === params.bannedById) return { ok: false, reason: "self" };

  const target = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true },
  });
  if (!target) return { ok: false, reason: "not_found" };

  const ban = await prisma.userBan.create({
    data: {
      userId: params.userId,
      kind: params.kind,
      reason,
      expiresAt: banExpiry(params.duration, new Date()),
      bannedById: params.bannedById,
    },
    select: { id: true },
  });

  return { ok: true, banId: ban.id };
}

/**
 * End a ban before its expiry.
 *
 * Stamps `liftedAt` rather than deleting the row: "an admin changed their
 * mind" and "it ran its course" are different facts, and both belong in the
 * history.
 */
export async function liftBan(
  banId: string,
): Promise<{ ok: boolean; reason?: "not_found" }> {
  const { count } = await prisma.userBan.updateMany({
    where: { id: banId, liftedAt: null },
    data: { liftedAt: new Date() },
  });
  return count === 0 ? { ok: false, reason: "not_found" } : { ok: true };
}

export const BAN_KIND_LABEL: Record<BanKind, string> = {
  login: "ห้ามเข้าสู่ระบบ",
  bidding: "ห้ามเสนอราคา",
};

/** What the banned person is told, in one line. */
export function banMessageFor(ban: ActiveBan): string {
  const until = ban.expiresAt
    ? ` ถึง ${new Intl.DateTimeFormat("th-TH", {
        timeZone: "Asia/Bangkok",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(ban.expiresAt)}`
    : " แบบถาวร";
  return `บัญชีนี้ถูก${BAN_KIND_LABEL[ban.kind]}${until} — ${ban.reason}`;
}
