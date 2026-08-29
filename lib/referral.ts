import "server-only";

import { randomInt } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
  normaliseReferralCode,
  REFERRAL_ALPHABET,
  REFERRAL_CODE_LENGTH,
} from "@/lib/referral-code";
import type { ReferralStatus } from "@/generated/prisma/enums";

/**
 * Inviting a friend.
 *
 * There is NO REWARD. Nothing in this file grants, credits or discounts
 * anything, and the UI must not say otherwise — a promise the product cannot
 * keep is an advertising problem, not a copy problem. What this does is record
 * who brought whom, and how far that person got, so that a reward scheme (if
 * one is ever decided on) is built on a history that already exists rather than
 * on a table that starts empty on the day it launches.
 *
 * The codes themselves, and the cookie that carries one, are in
 * lib/referral-code.ts — it has to stay free of Prisma so proxy.ts can use it
 * at the edge.
 *
 * The attribution rules, in one place:
 *
 *   - FIRST TOUCH. The first `?ref=` a browser sees is kept for 30 days and a
 *     later link does not overwrite it. Whoever did the work of getting someone
 *     here keeps the credit even if the person wanders off and comes back
 *     through somebody else.
 *   - ONCE, THEN NEVER AGAIN. The row is written at sign-up and `referredId` is
 *     unique, so an account has one referrer for as long as it exists. Nothing
 *     here can rebind it, and neither can anything else.
 *   - NEVER YOURSELF. Signing up through your own code records nothing, and
 *     says nothing either — there is no error to show someone who has done
 *     nothing wrong and gained nothing by it.
 *   - NEVER FATAL. Every entry point catches its own failures. Creating an
 *     account and verifying a phone are things a person did; losing the
 *     referral that came with one is a smaller loss than failing the thing they
 *     actually asked for, which is exactly the trade lib/notifications.ts
 *     makes for the same reason.
 */

/** How many collisions to ride out before giving up. */
const MAX_CODE_ATTEMPTS = 8;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    // randomInt, not Math.random: a guessable invite code would let someone
    // attribute their own new accounts to a stranger.
    code += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  }
  return code;
}

/**
 * This account's code, made on first sight.
 *
 * Called when the invite page is opened, so an account that never opens it
 * never gets one. The retry is for the unique index: two accounts can draw the
 * same six characters, and the honest fix is to draw again rather than to
 * pretend it cannot happen.
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (existing?.referralCode) return existing.referralCode;

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = randomCode();
    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { referralCode: code },
        select: { referralCode: true },
      });
      return updated.referralCode!;
    } catch {
      // Either this code is taken, or another request generated one for this
      // same account a moment ago. Both are answered by looking again.
      const now = await prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
      });
      if (now?.referralCode) return now.referralCode;
    }
  }

  throw new Error("could not allocate a referral code");
}

/** Who a code belongs to, or null when nobody has it. */
export async function referrerForCode(code: string): Promise<string | null> {
  const normalised = normaliseReferralCode(code);
  if (!normalised) return null;

  const owner = await prisma.user.findUnique({
    where: { referralCode: normalised },
    select: { id: true },
  });
  return owner?.id ?? null;
}

/**
 * Bind a new account to whoever invited it.
 *
 * Returns the referral's id, or null for every "nothing to record" case: no
 * code, an unknown one, the account's own, or an account that is already bound.
 * None of those is an error — a sign-up that was going to succeed still
 * succeeds, which is the whole contract this function has with its callers.
 */
export async function recordSignupReferral(input: {
  referredUserId: string;
  code: string | null | undefined;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<string | null> {
  try {
    const code = normaliseReferralCode(input.code);
    if (!code) return null;

    const referrerId = await referrerForCode(code);
    if (!referrerId) return null;

    // Inviting yourself is not an error to be shown, it is simply not a
    // referral. lib/fraud-signals.ts exists because the interesting version of
    // this is done with a SECOND account, which no rule here can see.
    if (referrerId === input.referredUserId) return null;

    const created = await prisma.referral.create({
      data: {
        referrerId,
        referredId: input.referredUserId,
        code,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // The account already exists by the time this runs. Losing its referral is
    // a smaller failure than telling someone their sign-up did not work — and
    // the commonest way to land here is the unique index refusing to rebind an
    // account that already has a referrer, which is the rule working.
    console.error("[referral] sign-up attribution failed:", error);
    return null;
  }
}

/**
 * Move a referral to `verified`, once the invited account proves a phone.
 *
 * Only ever forward, and only from `signed_up`: the WHERE clause carries the
 * status, so re-verifying a second number cannot rewrite the date on which this
 * account first became a verified one.
 */
export async function markReferralVerified(referredUserId: string): Promise<boolean> {
  try {
    const { count } = await prisma.referral.updateMany({
      where: { referredId: referredUserId, status: "signed_up" },
      data: { status: "verified", verifiedAt: new Date() },
    });
    return count > 0;
  } catch (error) {
    // The phone IS verified by now; the row saying so is already written.
    console.error("[referral] verification update failed:", error);
    return false;
  }
}

export type ReferredFriend = {
  id: string;
  /** The display name, and deliberately nothing else. */
  name: string;
  status: ReferralStatus;
  signedUpAt: Date;
  verifiedAt: Date | null;
};

/**
 * Who this account has brought in.
 *
 * The name, the state and the dates. NOT the email, NOT the phone: the person
 * who accepted an invitation did not thereby agree to hand their contact
 * details to whoever sent it, and "how many friends have joined" needs none of
 * it to be answered.
 */
export async function listReferrals(referrerId: string): Promise<ReferredFriend[]> {
  const rows = await prisma.referral.findMany({
    where: { referrerId },
    orderBy: { signedUpAt: "desc" },
    select: {
      id: true,
      status: true,
      signedUpAt: true,
      verifiedAt: true,
      referred: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.referred.name,
    status: row.status,
    signedUpAt: row.signedUpAt,
    verifiedAt: row.verifiedAt,
  }));
}

/** Thai labels for the two states, so the page and any future tool agree. */
export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  signed_up: "สมัครแล้ว",
  verified: "ยืนยันเบอร์แล้ว",
};
