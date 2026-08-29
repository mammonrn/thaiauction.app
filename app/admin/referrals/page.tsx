import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/admin";
import {
  RING_MIN_ACCOUNTS,
  percentage,
  referralReport,
  type ReferralRing,
  type ReferralTotals,
  type ReferrerRow,
} from "@/lib/referral-report";
import { formatThaiDate } from "@/lib/thai-datetime";

export const metadata = { title: "ชวนเพื่อน" };

/**
 * What inviting has produced, across the marketplace.
 *
 * Counts, not entitlements: there is still no reward for inviting anybody (see
 * lib/referral.ts), and a leaderboard is precisely the page where that
 * distinction gets quietly lost. It says how many people arrived through a
 * link and how many of them went on to prove a phone number, and it names the
 * groups that look like one person rather than several.
 *
 * READ ONLY, like the member page it links into. `requireAdmin` is called here
 * rather than relied on from the layout, for the reason every other admin page
 * calls it: layouts do not re-render on navigation.
 */
export default async function AdminReferralsPage() {
  await requireAdmin("/admin/referrals");

  const report = await referralReport();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <AdminBackLink />
        <h1 className="text-2xl font-semibold tracking-tight">ชวนเพื่อน</h1>
        <p className="text-sm text-ink/60">
          ใครชวนใครมาบ้าง และมีกี่คนที่ยืนยันเบอร์แล้ว
        </p>
      </header>

      <Summary totals={report.totals} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">ผู้ชวน</h2>
        {report.referrers.length === 0 ? (
          <p className="text-sm text-ink/60">ยังไม่มีใครชวนใครสำเร็จ</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.referrers.map((row) => (
              <ReferrerCard key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">สัญญาณน่าสงสัย</h2>
        <p className="text-sm text-ink/60">
          ผู้ชวนที่มีคนสมัครผ่านลิงก์ตั้งแต่ {RING_MIN_ACCOUNTS} บัญชีขึ้นไปจากต้นทางเดียวกัน
          — อาจเป็นคนเดียวสมัครหลายบัญชี หรือบ้านเดียวกัน ต้องดูด้วยตา
        </p>

        {report.rings.length === 0 ? (
          <p className="text-sm text-ink/60">ไม่พบสัญญาณ</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.rings.map((ring) => (
              <RingCard key={`${ring.referrerId}-${ring.ip}`} ring={ring} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * The three figures.
 *
 * Conversion is the one that matters — an invite that produced an account
 * nobody ever verified is a number, not a member — so it is set as a figure in
 * its own right rather than left for the reader to divide.
 */
function Summary({ totals }: { totals: ReferralTotals }) {
  const change = totals.last30 - totals.previous30;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile
        label="ชวนมาทั้งหมด"
        value={totals.total.toLocaleString("th-TH")}
        unit="คน"
        detail={totals.total === 0 ? "ยังไม่มีใครสมัครผ่านลิงก์" : "นับตั้งแต่เริ่มระบบ"}
      />
      <Tile
        label="ยืนยันเบอร์แล้ว"
        value={`${totals.verifiedPercent}%`}
        unit=""
        detail={`${totals.verified.toLocaleString("th-TH")} จาก ${totals.total.toLocaleString("th-TH")} คน`}
      />
      <Tile
        label="30 วันล่าสุด"
        value={totals.last30.toLocaleString("th-TH")}
        unit="คน"
        detail={
          totals.previous30 === 0
            ? "ไม่มีข้อมูล 30 วันก่อนหน้าให้เทียบ"
            : `30 วันก่อนหน้า ${totals.previous30.toLocaleString("th-TH")} คน (${
                change > 0 ? "+" : ""
              }${percentage(change, totals.previous30)}%)`
        }
      />
    </div>
  );
}

/**
 * One figure.
 *
 * Same treatment the admin index gives its queues: the number is the subject,
 * set in the mono face at display size. Ink rather than brand — nothing here is
 * waiting to be acted on, it is a count.
 */
function Tile({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string;
  unit: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-white p-5">
      <span className="text-sm font-medium">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-3xl font-semibold tabular-nums">{value}</span>
        {unit ? <span className="text-xs text-ink/50">{unit}</span> : null}
      </span>
      <span className="text-xs text-ink/55">{detail}</span>
    </div>
  );
}

/** One inviter, with the split that matters: arrived, and stayed to verify. */
function ReferrerCard({ row }: { row: ReferrerRow }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-white p-4 text-sm">
      <span className="flex min-w-0 flex-col gap-0.5">
        <Link
          href={`/admin/members/${row.id}`}
          className="truncate font-medium text-info underline-offset-4 hover:underline"
        >
          {row.name}
        </Link>
        <span className="text-xs text-ink/50">ล่าสุด {formatThaiDate(row.lastAt)}</span>
      </span>

      <span className="flex items-center gap-4">
        <Figure value={row.total} label="ชวนมา" />
        <Figure value={row.verified} label="ยืนยันเบอร์" tone="success" />
        <Figure value={row.signedUp} label="ยังไม่ยืนยัน" />
      </span>
    </li>
  );
}

function Figure({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "success";
}) {
  return (
    <span className="flex flex-col items-end">
      <span
        className={`font-mono text-lg font-semibold tabular-nums ${
          tone === "success" && value > 0 ? "text-success" : "text-ink"
        }`}
      >
        {value.toLocaleString("th-TH")}
      </span>
      <span className="text-[11px] text-ink/50">{label}</span>
    </span>
  );
}

/**
 * One group worth a look.
 *
 * The address is shortened to the part that does the grouping. The last octet
 * would not tell an admin anything the first three have not already told them,
 * and it is a piece of personal data this page has no need to print.
 */
function RingCard({ ring }: { ring: ReferralRing }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl bg-white p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Link
          href={`/admin/members/${ring.referrerId}`}
          className="font-medium text-info underline-offset-4 hover:underline"
        >
          {ring.referrerName}
        </Link>
        <span className="text-xs text-ink/50">ล่าสุด {formatThaiDate(ring.lastAt)}</span>
      </div>

      <p className="text-xs text-ink/60">
        {ring.accounts.length} บัญชีจากต้นทาง <span className="font-mono">{ring.ip}</span>
      </p>

      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {ring.accounts.map((account) => (
          <li key={account.id}>
            <Link
              href={`/admin/members/${account.id}`}
              className="text-xs text-info underline-offset-4 hover:underline"
            >
              {account.name}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
