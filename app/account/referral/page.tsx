import Link from "next/link";

import { ReferralShare } from "@/components/referral-share";
import { requireSession } from "@/lib/session";
import {
  ensureReferralCode,
  listReferrals,
  REFERRAL_STATUS_LABEL,
  type ReferredFriend,
} from "@/lib/referral";
import { referralLink } from "@/lib/referral-code";
import { formatThaiDate } from "@/lib/thai-datetime";

export const metadata = { title: "ชวนเพื่อน" };

/**
 * The invite page.
 *
 * Opening it is what creates the code — nobody is issued one in advance, so the
 * unique index only ever holds codes somebody has actually been shown.
 *
 * The copy promises NOTHING. There is no reward scheme, so there is no reward
 * to mention, and a page that hints at one would be advertising something that
 * does not exist. What it does say is what the marketplace is, which is the
 * part a friend actually needs in order to decide.
 *
 * The history shows a name, a state and a date. Not an email, not a phone
 * number: someone who accepted an invitation did not agree to hand their
 * contact details to whoever sent it.
 */
export default async function ReferralPage() {
  const { user } = await requireSession("/account/referral");

  const code = await ensureReferralCode(user.id);
  const friends = await listReferrals(user.id);
  const link = referralLink(code);

  const verified = friends.filter((friend) => friend.status === "verified").length;

  return (
    <main className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        {/* Phones only: from sm: upwards the account sidebar is the way back,
            the same arrangement /account/phone and /account/addresses use. */}
        <Link
          href="/account"
          className="text-sm text-ink/60 underline-offset-4 hover:underline sm:hidden"
        >
          ← กลับหน้าบัญชีของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">ชวนเพื่อน</h1>
        <p className="text-sm text-ink/60">
          ส่งลิงก์นี้ให้เพื่อน แล้วดูได้ที่นี่ว่าใครสมัครแล้วบ้าง
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-xl bg-white p-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">ลิงก์ของคุณ</h2>
          <p className="text-sm text-ink/60">
            รหัสชวนของคุณคือ <span className="font-mono font-semibold">{code}</span>
          </p>
        </div>

        <ReferralShare link={link} message={INVITE_MESSAGE} />
      </section>

      <section className="flex flex-col gap-3 rounded-xl bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="font-medium">เพื่อนที่ชวนมา</h2>
          <p className="text-sm text-ink/55">
            {friends.length === 0
              ? "ยังไม่มี"
              : `${friends.length.toLocaleString("th-TH")} คน · ยืนยันเบอร์แล้ว ${verified.toLocaleString("th-TH")} คน`}
          </p>
        </div>

        {friends.length === 0 ? (
          <p className="text-sm text-ink/60">
            เมื่อมีคนสมัครผ่านลิงก์ของคุณ ชื่อจะขึ้นที่นี่
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[.06]">
            {friends.map((friend) => (
              <FriendRow key={friend.id} friend={friend} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * What gets shared.
 *
 * Three facts and an invitation: what is sold here, what makes it safer than a
 * post in a Facebook group, and what to do next. No reward, no discount, no
 * "สิทธิพิเศษ" — none of those exist, and the first person to be disappointed
 * by one would be right to be.
 */
const INVITE_MESSAGE =
  "ThaiAuction — ประมูลพระเครื่อง ของสะสม และของมือสอง จากผู้ขายที่ยืนยันตัวตนแล้ว " +
  "จ่ายผ่านบัตรหรือพร้อมเพย์ในเว็บ มาลองประมูลด้วยกัน";

/**
 * One friend.
 *
 * The date is the one that goes with the state — verified friends are dated by
 * the day they verified, not the day they joined, because that is the later
 * fact and the one the row is reporting.
 */
function FriendRow({ friend }: { friend: ReferredFriend }) {
  const verified = friend.status === "verified";
  const date = verified ? (friend.verifiedAt ?? friend.signedUpAt) : friend.signedUpAt;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
      <span className="font-medium">{friend.name}</span>
      <span className="flex items-center gap-2 text-xs">
        <span
          className={`rounded px-2 py-0.5 font-medium ${
            verified ? "bg-success/12 text-success" : "bg-black/[.06] text-ink/70"
          }`}
        >
          {REFERRAL_STATUS_LABEL[friend.status]}
        </span>
        <span className="text-ink/50">{formatThaiDate(date)}</span>
      </span>
    </li>
  );
}
