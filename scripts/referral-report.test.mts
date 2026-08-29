/**
 * The referral overview: do the counts add up, and does the ring detector fire
 * at three and stay quiet at two.
 *
 * This report is about the WHOLE marketplace — a total, a conversion rate, a
 * leaderboard — so its figures move whenever anybody signs up. Nothing here
 * asserts one of them outright. Instead:
 *
 *   - counts are read as a DELTA across this run's inserts, the way
 *     scripts/sales-report.test.mts reads the unfiltered report;
 *   - the percentage is asserted against the pure function that computes it,
 *     which can be asked every case including the awkward ones;
 *   - the leaderboard is checked by a property that holds at any table size:
 *     this run's referrer is either in the table or legitimately outranked by
 *     everyone in it;
 *   - the ring list is ordered newest-first, so a group created a moment ago
 *     is at the top of it whatever else the database holds.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server scripts/referral-report.test.mts
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import {
  RING_MIN_ACCOUNTS,
  maskIp,
  percentage,
  referralReport,
} from "../lib/referral-report";
import { ensureReferralCode, markReferralVerified, recordSignupReferral } from "../lib/referral";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         ${detail}`}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  check(label, String(actual) === String(expected), `got ${actual}, expected ${expected}`);
}

/* ----------------------------------------------------------------- fixtures */

async function resetFixtures() {
  const fixtures = await prisma.user.findMany({
    where: { email: { endsWith: "@example.com" } },
    select: { id: true },
  });
  if (fixtures.length === 0) return;
  const ids = fixtures.map((u) => u.id);

  await prisma.referral.deleteMany({
    where: { OR: [{ referrerId: { in: ids } }, { referredId: { in: ids } }] },
  });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.verifiedPhone.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function person(tag: string) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      email: `${tag}-${randomUUID().slice(0, 8)}@example.com`,
      name: `ผู้ใช้ ${tag}`,
    },
  });
}

/** Invite `count` accounts, all from one address. */
async function inviteFrom(referrerId: string, code: string, count: number, ip: string | null) {
  const invited = [];
  for (let i = 0; i < count; i++) {
    const friend = await person(`ถูกชวน-${i}`);
    await recordSignupReferral({
      referredUserId: friend.id,
      code,
      ipAddress: ip,
      userAgent: "Mozilla/5.0 (test)",
    });
    invited.push(friend);
  }
  return invited;
}

/* -------------------------------------------------------------------- tests */

async function main() {
  await resetFixtures();

  console.log("\nTHE PERCENTAGE, EVERY WAY ROUND");
  {
    eq("nothing out of nothing is zero, not NaN", percentage(0, 0), 0);
    eq("  and something out of nothing is still zero", percentage(5, 0), 0);
    eq("all of them is a hundred", percentage(7, 7), 100);
    eq("none of them is nought", percentage(0, 9), 0);
    eq("half is fifty", percentage(2, 4), 50);
    eq("a third rounds to 33", percentage(1, 3), 33);
    eq("two thirds round to 67", percentage(2, 3), 67);
    eq("a fall is negative, not hidden", percentage(-4, 8), -50);
  }

  console.log("\nHOW MUCH OF AN ADDRESS IS SHOWN");
  {
    eq("an IPv4 keeps its network and loses its host", maskIp("203.0.113.45"), "203.0.113.···");
    eq("  whatever the last octet is", maskIp("203.0.113.9"), "203.0.113.···");
    check(
      "  so two neighbours group together",
      maskIp("203.0.113.9") === maskIp("203.0.113.45"),
    );
    check(
      "  and two strangers do not",
      maskIp("203.0.113.9") !== maskIp("198.51.100.9"),
    );
    eq("an IPv6 is cut after its routing half", maskIp("2001:db8:1234:5678::1"), "2001:db8:1234:···");
    eq("nonsense shows nothing at all", maskIp("not-an-address"), "···");
  }

  const before = await referralReport();

  console.log("\nWHAT THIS RUN ADDS TO THE TOTALS");
  const inviter = await person("ผู้ชวนหลัก");
  const code = await ensureReferralCode(inviter.id);
  const invited = await inviteFrom(inviter.id, code, 4, "203.0.113.77");
  await markReferralVerified(invited[0]!.id);
  {
    const after = await referralReport();

    eq("four more referrals", after.totals.total - before.totals.total, 4);
    eq("  one of them verified", after.totals.verified - before.totals.verified, 1);
    eq("  all four inside the last thirty days", after.totals.last30 - before.totals.last30, 4);
    eq(
      "  and none of them in the thirty before that",
      after.totals.previous30 - before.totals.previous30,
      0,
    );
    eq(
      "the conversion figure is the one the counts give",
      after.totals.verifiedPercent,
      percentage(after.totals.verified, after.totals.total),
    );
  }

  console.log("\nTHE TABLE OF INVITERS");
  {
    const report = await referralReport();
    const row = report.referrers.find((r) => r.id === inviter.id);

    // Holds at any table size: either this run's inviter is on the leaderboard,
    // or everybody on it brought in at least as many people.
    check(
      "this run's inviter is listed, or outranked by everyone who is",
      row !== undefined || report.referrers.every((r) => r.total >= 4),
      `${report.referrers.length} rows`,
    );

    if (row) {
      eq("  their total is everyone they brought in", row.total, 4);
      eq("    of whom one verified", row.verified, 1);
      eq("    and three did not", row.signedUp, 3);
      eq("    which adds back to the total", row.signedUp + row.verified, row.total);
      eq("  under their own name", row.name, inviter.name);
    }

    // Absence is absence at any table size.
    const empty = await person("มีรหัสแต่ไม่มีใคร");
    await ensureReferralCode(empty.id);
    const withEmpty = await referralReport();
    check(
      "an inviter nobody used is not in the table at all",
      withEmpty.referrers.every((r) => r.id !== empty.id),
    );
    check(
      "  and neither is one of the people they might have invited",
      withEmpty.referrers.every((r) => r.id !== invited[0]!.id),
    );
  }

  console.log("\nSEVERAL ACCOUNTS FROM ONE ADDRESS");
  {
    // Ordered newest-first, so a group written a moment ago is at the top
    // whatever else the table holds.
    const report = await referralReport();
    const ring = report.rings.find((r) => r.referrerId === inviter.id);

    check(`${RING_MIN_ACCOUNTS} accounts from one address is a signal`, ring !== undefined);
    eq("  it names every account in the group", ring?.accounts.length, 4);
    eq("  and the inviter who benefits", ring?.referrerName, inviter.name);
    eq("  with the address shortened", ring?.ip, "203.0.113.···");
    check(
      "  and never in full",
      !JSON.stringify(report.rings).includes("203.0.113.77"),
    );
    check(
      "  the accounts are the ones that signed up",
      ring!.accounts.every((account) => invited.some((f) => f.id === account.id)),
      JSON.stringify(ring?.accounts),
    );
  }

  console.log("\nTWO IS NOT A RING");
  {
    const quiet = await person("ผู้ชวนสองคน");
    const quietCode = await ensureReferralCode(quiet.id);
    await inviteFrom(quiet.id, quietCode, RING_MIN_ACCOUNTS - 1, "198.51.100.20");

    const report = await referralReport();
    check(
      `${RING_MIN_ACCOUNTS - 1} accounts from one address is not`,
      report.rings.every((r) => r.referrerId !== quiet.id),
      JSON.stringify(report.rings.filter((r) => r.referrerId === quiet.id)),
    );

    // ...and the third one tips it over.
    await inviteFrom(quiet.id, quietCode, 1, "198.51.100.20");
    const tipped = await referralReport();
    const ring = tipped.rings.find((r) => r.referrerId === quiet.id);
    check("  until the third account arrives", ring !== undefined);
    eq("    and then it is exactly those three", ring?.accounts.length, RING_MIN_ACCOUNTS);
  }

  console.log("\nSPREAD OUT, AND SO NOT A RING");
  {
    const spread = await person("ผู้ชวนจากหลายที่");
    const spreadCode = await ensureReferralCode(spread.id);
    await inviteFrom(spread.id, spreadCode, 1, "198.51.100.31");
    await inviteFrom(spread.id, spreadCode, 1, "198.51.100.32");
    await inviteFrom(spread.id, spreadCode, 1, "198.51.100.33");

    const report = await referralReport();
    check(
      "three accounts from three addresses is not a signal",
      report.rings.every((r) => r.referrerId !== spread.id),
      JSON.stringify(report.rings.filter((r) => r.referrerId === spread.id)),
    );

    // A sign-up with no address recorded cannot be grouped by one.
    const anonymous = await person("ผู้ชวนไม่มีไอพี");
    const anonymousCode = await ensureReferralCode(anonymous.id);
    await inviteFrom(anonymous.id, anonymousCode, RING_MIN_ACCOUNTS + 1, null);
    const withAnonymous = await referralReport();
    check(
      "and neither is a set with no address at all",
      withAnonymous.rings.every((r) => r.referrerId !== anonymous.id),
    );
  }

  await resetFixtures();

  console.log("\nNOTHING LEFT BEHIND");
  {
    const after = await referralReport();
    eq("the totals are back where they started", after.totals.total, before.totals.total);
    eq("  including the verified ones", after.totals.verified, before.totals.verified);
    check(
      "  and this run's inviter is out of the table",
      after.referrers.every((r) => r.id !== inviter.id),
    );
    check("  and out of the signals", after.rings.every((r) => r.referrerId !== inviter.id));
  }

  console.log(failures === 0 ? "\nreferral report holds" : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("[referral-report.test] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
