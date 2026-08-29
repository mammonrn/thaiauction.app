import Link from "next/link";

import { requireAdmin } from "@/lib/admin";
import { findFraudSignals } from "@/lib/fraud-signals";
import { formatBaht } from "@/lib/money";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "ผู้ดูแลระบบ" };

/**
 * The admin index.
 *
 * Guarded by exactly the same `requireAdmin` the three tools use — a signed-in
 * non-admin gets a 404, not a 403, so a stranger who guesses the path learns
 * nothing about whether an admin area exists. Nothing in the public UI links
 * here; it is reached by typing the URL, which is why the guard is the whole
 * protection and not a convenience on top of an obscure address.
 *
 * Each tile carries what is WAITING, because that is the only number that
 * decides whether the page is worth opening.
 */
export default async function AdminHomePage() {
  const session = await requireAdmin("/admin");

  const [pendingKyc, pendingPayouts, owed, signals, openReports] = await Promise.all([
    prisma.sellerVerification.count({ where: { status: "pending" } }),
    prisma.payment.count({
      where: { status: "successful", payoutStatus: "pending" },
    }),
    prisma.payment.aggregate({
      where: { status: "successful", payoutStatus: "pending" },
      _sum: { sellerNet: true },
    }),
    // The heaviest of the three: it groups every bid by origin. Bounded by the
    // same limit the fraud page uses, and this page is admin-only traffic.
    findFraudSignals(50),
    // Distinct listings with something open, not the raw report count: the
    // queue is a list of things to look at, and ten reports of one listing is
    // still one decision.
    prisma.itemReport
      .groupBy({ by: ["auctionItemId"], where: { status: "open" } })
      .then((rows) => rows.length),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">ผู้ดูแลระบบ</h1>
        <p className="text-sm text-ink/60">
          เข้าสู่ระบบเป็น {session.user.email}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          href="/admin/verifications"
          title="ยืนยันตัวตนผู้ขาย"
          count={pendingKyc}
          unit="ราย"
          detail={
            pendingKyc === 0
              ? "ไม่มีคำขอค้าง"
              : "รอตรวจบัตรประชาชน — รูปจะถูกลบทันทีที่ตัดสิน"
          }
        />
        <Tile
          href="/admin/payouts"
          title="รอโอนให้ผู้ขาย"
          count={pendingPayouts}
          unit="รายการ"
          detail={
            pendingPayouts === 0
              ? "ไม่มีรายการค้าง"
              : `รวม ${formatBaht(owed._sum.sellerNet ?? 0)}`
          }
        />
        <Tile
          href="/admin/reports"
          title="สินค้าที่ถูกแจ้ง"
          count={openReports}
          unit="รายการ"
          detail={
            openReports === 0
              ? "ไม่มีเรื่องค้าง"
              : "ผู้ใช้แจ้งว่าไม่เหมาะสม — ตรวจแล้วลบหรือปิดเรื่องได้"
          }
        />
        <Tile
          href="/admin/fraud"
          title="สัญญาณน่าสงสัย"
          count={signals.length}
          unit="กลุ่ม"
          detail={
            signals.length === 0
              ? "ไม่พบสัญญาณ"
              : "หลายบัญชีจากต้นทางเดียวกัน — ต้องตรวจด้วยตนเอง"
          }
        />
      </div>

      {/* Not tiles. Every tile above counts something WAITING, and neither of
          these is a queue — nothing here is owed or overdue. In the row they
          would look exactly like the four numbers that do need acting on. */}
      <div className="flex flex-wrap gap-4">
        <Link
          href="/admin/reports/sales"
          className="text-sm text-info underline-offset-4 hover:underline"
        >
          รายงานยอดขาย →
        </Link>
        <Link
          href="/admin/bans"
          className="text-sm text-info underline-offset-4 hover:underline"
        >
          ประวัติการแบนบัญชี →
        </Link>
      </div>

      <p className="text-xs text-ink/45">
        สิทธิ์เข้าถึงกำหนดด้วย ADMIN_EMAILS
      </p>
    </main>
  );
}

/**
 * A tool, with what is waiting in it.
 *
 * The count is the tile's subject, so it is set in the mono face at display
 * size — the same treatment prices get, for the same reason: it is a figure to
 * be read at a glance. It is NOT gold; gold belongs to money.
 */
function Tile({
  href,
  title,
  count,
  unit,
  detail,
}: {
  href: string;
  title: string;
  count: number;
  unit: string;
  detail: string;
}) {
  const waiting = count > 0;

  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-xl bg-white p-5 transition-shadow hover:shadow-[0_4px_14px_rgb(0_0_0/0.10)]"
    >
      <span className="text-sm font-medium">{title}</span>
      <span className="flex items-baseline gap-1.5">
        <span
          className={`font-mono text-3xl font-semibold tabular-nums ${
            waiting ? "text-brand" : "text-ink/30"
          }`}
        >
          {count}
        </span>
        <span className="text-xs text-ink/50">{unit}</span>
      </span>
      <span className="text-xs text-ink/55">{detail}</span>
    </Link>
  );
}
