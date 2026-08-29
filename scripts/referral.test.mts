/**
 * Inviting a friend: who gets the credit, and who does not.
 *
 * The risk in an attribution system is that it is generous in the wrong
 * direction — a row written for someone who invited themselves, a second
 * invite overwriting the first, a code that got misread landing on a stranger.
 * So the tests are mostly about what does NOT get recorded, and every one of
 * them is scoped to the accounts this run created: it runs against whatever
 * DATABASE_URL points at, and on a live database "how many referrals are
 * there" is a moving number that no assertion should depend on.
 *
 * That scoping is the pattern scripts/sales-report.test.mts established —
 * count what belongs to this run's own fixtures, never the table.
 *
 * The two entry points are covered as functions rather than through the
 * endpoints that call them: the sign-up hook lives inside Better Auth's own
 * request handling and the verify hook behind an SMS provider, so calling
 * either here would be asserting a copy of it. What the hooks add is a
 * try/catch, and the functions they wrap swallow their own failures — which is
 * asserted directly below.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server scripts/referral.test.mts
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";
import {
  ensureReferralCode,
  listReferrals,
  markReferralVerified,
  recordSignupReferral,
  referrerForCode,
  REFERRAL_STATUS_LABEL,
} from "../lib/referral";
import {
  normaliseReferralCode,
  REFERRAL_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE,
  referralCookieUpdate,
  referralLink,
} from "../lib/referral-code";

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

  // Referrals FIRST, before the users either side of them go.
  //
  // The rows would go anyway — both foreign keys cascade, deliberately, so
  // that a table added here could not break the half-dozen suites that delete
  // their fixture users directly. This is belt and braces: it keeps the
  // suite's cleanup true even if that cascade is ever reconsidered, and it is
  // the order every other suite in this directory already follows.
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

/** This run's referrals only — never the table's. */
async function referralsOf(referrerId: string) {
  return prisma.referral.findMany({
    where: { referrerId },
    orderBy: { signedUpAt: "asc" },
  });
}

/* -------------------------------------------------------------------- tests */

async function main() {
  await resetFixtures();

  console.log("\nTHE CODE");
  const inviter = await person("ผู้ชวน");
  {
    const code = await ensureReferralCode(inviter.id);
    eq("a code is six characters", code.length, REFERRAL_CODE_LENGTH);
    check(
      "  drawn only from the unambiguous alphabet",
      [...code].every((c) => REFERRAL_ALPHABET.includes(c)),
      code,
    );
    check(
      "  so it can carry no 0/O and no 1/I/L",
      !/[01OIL]/.test(code) && !/[01OIL]/.test(REFERRAL_ALPHABET),
      `${code} from ${REFERRAL_ALPHABET}`,
    );

    const again = await ensureReferralCode(inviter.id);
    eq("asking twice returns the same code", again, code);

    const other = await person("อีกคน");
    const otherCode = await ensureReferralCode(other.id);
    check("another account gets a different one", otherCode !== code, `${code} vs ${otherCode}`);

    const stranger = await person("คนที่ไม่เคยเปิดหน้าชวน");
    const unopened = await prisma.user.findUniqueOrThrow({
      where: { id: stranger.id },
      select: { referralCode: true },
    });
    eq("an account that never opens the page has none", unopened.referralCode, null);

    eq("a code finds its owner", await referrerForCode(code), inviter.id);
    eq("  however it was typed", await referrerForCode(` ${code.toLowerCase()} `), inviter.id);
    eq("a code nobody has finds nobody", await referrerForCode("ZZZZZZ"), null);

    eq("the link is the home page with ?ref=", referralLink(code, "https://thaiauction.app"),
      `https://thaiauction.app/?ref=${code}`);
  }

  console.log("\nREADING A CODE");
  {
    const code = await ensureReferralCode(inviter.id);
    eq("lower case is the same code", normaliseReferralCode(code.toLowerCase()), code);
    eq("so is one with spaces round it", normaliseReferralCode(`  ${code} `), code);
    eq("five characters is not a code", normaliseReferralCode("ABCDE"), null);
    eq("nor is seven", normaliseReferralCode("ABCDEFG"), null);
    eq("nor is nothing at all", normaliseReferralCode(""), null);
    eq("nor is a missing one", normaliseReferralCode(undefined), null);
    // The characters the alphabet leaves out, one at a time: each is a
    // misreading of a character that IS in it, and must not be accepted as if
    // it were that one.
    for (const ambiguous of ["0AAAAA", "1AAAAA", "OAAAAA", "IAAAAA", "LAAAAA"]) {
      eq(`  and ${ambiguous[0]} is not in the alphabet`, normaliseReferralCode(ambiguous), null);
    }
    eq("neither is punctuation", normaliseReferralCode("AB-CDE"), null);
  }

  console.log("\nFIRST TOUCH WINS");
  {
    const url = (query: string) => new URL(`https://thaiauction.app/${query}`);

    eq("a page with no ?ref= changes nothing", referralCookieUpdate(url(""), null), null);
    eq("a first ?ref= is kept", referralCookieUpdate(url("?ref=K7QF3M"), null), "K7QF3M");
    eq(
      "  from any page, not only the home page",
      referralCookieUpdate(new URL("https://thaiauction.app/auctions/abc?ref=K7QF3M"), null),
      "K7QF3M",
    );
    eq(
      "  and typed in lower case",
      referralCookieUpdate(url("?ref=k7qf3m"), null),
      "K7QF3M",
    );
    eq(
      "a second link does NOT take the credit",
      referralCookieUpdate(url("?ref=AAAAAA"), "K7QF3M"),
      null,
    );
    eq(
      "  but a cookie that is not a code is replaced",
      referralCookieUpdate(url("?ref=AAAAAA"), "not-a-code"),
      "AAAAAA",
    );
    eq(
      "a ?ref= that is not a code is ignored",
      referralCookieUpdate(url("?ref=1"), null),
      null,
    );
    eq("the cookie lasts thirty days", REFERRAL_COOKIE_MAX_AGE, 30 * 24 * 60 * 60);
    eq("  under one name", REFERRAL_COOKIE, "ta_ref");
  }

  console.log("\nSIGNING UP THROUGH A LINK");
  const code = await ensureReferralCode(inviter.id);
  {
    const friend = await person("เพื่อน");
    const id = await recordSignupReferral({
      referredUserId: friend.id,
      code,
      ipAddress: "203.0.113.9",
      userAgent: "Mozilla/5.0 (test)",
    });
    check("a sign-up through a link is recorded", id !== null, `${id}`);

    const rows = await referralsOf(inviter.id);
    eq("  one row, for this friend", rows.length, 1);
    eq("  bound to the inviter", rows[0]?.referrerId, inviter.id);
    eq("  and to the friend", rows[0]?.referredId, friend.id);
    eq("  starting at signed_up", rows[0]?.status, "signed_up");
    eq("  with the code that was used", rows[0]?.code, code);
    check("  and no verification date yet", rows[0]?.verifiedAt === null, `${rows[0]?.verifiedAt}`);

    // Groundwork for lib/fraud-signals.ts, which groups accounts by origin. It
    // adds no signal today; it cannot add one later over data nobody kept.
    eq("  the origin is kept for fraud review", rows[0]?.ipAddress, "203.0.113.9");
    eq("  including the device string", rows[0]?.userAgent, "Mozilla/5.0 (test)");
  }

  console.log("\nWHAT IS NOT RECORDED");
  {
    const before = (await referralsOf(inviter.id)).length;

    const self = await recordSignupReferral({ referredUserId: inviter.id, code });
    eq("inviting yourself records nothing", self, null);
    eq("  and raises nothing to show anyone", `${self}`, "null");

    const stranger = await person("มากับรหัสมั่ว");
    const unknown = await recordSignupReferral({ referredUserId: stranger.id, code: "ZZZZZZ" });
    eq("a code nobody owns records nothing", unknown, null);

    const noCookie = await person("มาเอง");
    eq(
      "no code at all records nothing",
      await recordSignupReferral({ referredUserId: noCookie.id, code: null }),
      null,
    );
    eq(
      "  and neither does a malformed one",
      await recordSignupReferral({ referredUserId: noCookie.id, code: "1IL0O!" }),
      null,
    );

    // Every one of those accounts still exists: none of this is an error, and
    // a sign-up that was going to succeed still did.
    const strangerStill = await prisma.user.count({ where: { id: stranger.id } });
    eq("the accounts were created all the same", strangerStill, 1);

    eq("nothing was added to this run's history", (await referralsOf(inviter.id)).length, before);
  }

  console.log("\nBOUND ONCE, AND FOR GOOD");
  {
    const rival = await person("ผู้ชวนอีกคน");
    const rivalCode = await ensureReferralCode(rival.id);

    const [friendRow] = await referralsOf(inviter.id);
    const friendId = friendRow!.referredId;

    const second = await recordSignupReferral({ referredUserId: friendId, code: rivalCode });
    eq("a second referrer is refused", second, null);
    eq("  the rival gains nothing", (await referralsOf(rival.id)).length, 0);

    const rows = await referralsOf(inviter.id);
    eq("  and the first binding is untouched", rows.length, 1);
    eq("    still the original inviter", rows[0]?.referrerId, inviter.id);
    eq("    with the original code", rows[0]?.code, code);
  }

  console.log("\nNOTHING HERE CAN BREAK A SIGN-UP");
  {
    // A referred id that belongs to nobody: the insert violates the foreign
    // key, which is the closest thing to "the referral system broke" that can
    // be arranged on purpose. It must come back as null, not as a throw — a
    // throw here would reach Better Auth's user-creation hook.
    let threw = false;
    let result: string | null = "not-null";
    // The failure is deliberate, so its stack trace is noise rather than news.
    // Silenced only around the call, so a real one anywhere else still shows.
    const complain = console.error;
    console.error = () => {};
    try {
      result = await recordSignupReferral({
        referredUserId: `missing-${randomUUID()}`,
        code,
      });
    } catch {
      threw = true;
    } finally {
      console.error = complain;
    }
    check("a broken write is swallowed, not thrown", !threw);
    eq("  and reports nothing recorded", result, null);

    let verifyThrew = false;
    try {
      await markReferralVerified(`missing-${randomUUID()}`);
    } catch {
      verifyThrew = true;
    }
    check("verifying an account with no referral is quiet too", !verifyThrew);
  }

  console.log("\nVERIFYING A PHONE");
  {
    const [row] = await referralsOf(inviter.id);
    const friendId = row!.referredId;

    const moved = await markReferralVerified(friendId);
    check("verifying a phone moves the referral on", moved);

    const [after] = await referralsOf(inviter.id);
    eq("  the status is verified", after?.status, "verified");
    check("  and it is dated", after?.verifiedAt instanceof Date, `${after?.verifiedAt}`);
    eq("  the sign-up date is unchanged", `${after?.signedUpAt}`, `${row?.signedUpAt}`);

    const firstVerifiedAt = after!.verifiedAt!.toISOString();
    const again = await markReferralVerified(friendId);
    check("verifying a second number does not move it again", !again);
    const [twice] = await referralsOf(inviter.id);
    eq("  the first verification date stands", twice?.verifiedAt?.toISOString(), firstVerifiedAt);

    const strangerId = (await person("ไม่มีใครชวน")).id;
    check("someone nobody invited verifies nothing", !(await markReferralVerified(strangerId)));
  }

  console.log("\nWHAT THE INVITER SEES");
  {
    const second = await person("เพื่อนคนที่สอง");
    await recordSignupReferral({ referredUserId: second.id, code });

    const friends = await listReferrals(inviter.id);
    eq("both friends are listed", friends.length, 2);
    eq("  newest first", friends[0]?.name, second.name);

    const verified = friends.find((f) => f.status === "verified");
    const signedUp = friends.find((f) => f.status === "signed_up");
    check("one of each state", verified !== undefined && signedUp !== undefined);
    eq("  and the Thai for them", REFERRAL_STATUS_LABEL.verified, "ยืนยันเบอร์แล้ว");
    eq("  including the other", REFERRAL_STATUS_LABEL.signed_up, "สมัครแล้ว");

    // The privacy rule, asserted rather than trusted: a name is a name, and an
    // email address is contact detail the invited person never offered up.
    const keys = Object.keys(friends[0] ?? {}).sort();
    eq(
      "a friend is a name, a state and two dates — nothing else",
      keys.join(","),
      "id,name,signedUpAt,status,verifiedAt",
    );

    const rival = await prisma.user.findFirst({
      where: { email: { startsWith: "ผู้ชวนอีกคน-" } },
      select: { id: true },
    });
    eq("another inviter's list is their own", (await listReferrals(rival!.id)).length, 0);
  }

  await resetFixtures();

  console.log("\nNOTHING LEFT BEHIND");
  {
    const left = await prisma.referral.count({ where: { referrerId: inviter.id } });
    eq("this run's referrals are gone", left, 0);
    const users = await prisma.user.count({ where: { email: { endsWith: "@example.com" } } });
    eq("  and so are its accounts", users, 0);
  }

  console.log(failures === 0 ? "\nreferrals hold" : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("[referral.test] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
