import Link from "next/link";

import { formatBaht } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { countStrikes, STRIKE_LIMIT } from "@/lib/strikes";
import { formatThaiDateTime } from "@/lib/thai-datetime";
import { btnPrimarySm } from "@/lib/button";

/**
 * A buyer's own bidding history.
 *
 * Strictly their own: every query here is filtered by the session user id, so
 * there is no identifier a visitor could substitute to read someone else's
 * record. Their strike count is shown to them plainly — someone one missed
 * deadline away from losing the right to bid should not find out by being
 * refused.
 */
export default async function MyBidsPage() {
  const { user } = await requireSession("/account/bids");

  const [items, strikes] = await Promise.all([
    prisma.auctionItem.findMany({
      where: { bids: { some: { bidderId: user.id } } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        status: true,
        currentPrice: true,
        winnerId: true,
        paymentState: true,
        paymentDueAt: true,
        endedAt: true,
        bids: {
          where: { bidderId: user.id },
          orderBy: { amount: "desc" },
          take: 1,
          select: { amount: true, createdAt: true },
        },
        payments: {
          where: { payerId: user.id },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, paidAt: true },
        },
      },
    }),
    countStrikes(user.id),
  ]);

  const banned = strikes >= STRIKE_LIMIT;

  // Read once per request. react-hooks/purity guards client components, which
  // can re-render at any moment; this is an async Server Component that runs
  // once and needs to know whether each deadline has passed.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <main className="flex w-full flex-col gap-5">
      <Link
        href="/account"
        className="text-sm text-ink/60 underline-offset-4 hover:underline sm:hidden"
      >
        ← บัญชีของฉัน
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          ประวัติการประมูล
        </h1>
      </header>

      {strikes > 0 ? (
        <section
          className={`rounded-xl border p-5 text-sm ${
            banned
              ? "border-brand/30 bg-brand/[.05]"
              : "border-amber-500/40 bg-amber-50"
          }`}
        >
          <h2 className="font-semibold">
            {banned
              ? "บัญชีของคุณถูกระงับสิทธิ์การเสนอราคา"
              : `คุณมีประวัติไม่ชำระเงิน ${strikes} ครั้ง`}
          </h2>
          <p className="mt-1">
            {banned
              ? `เนื่องจากไม่ชำระเงินตามกำหนดครบ ${STRIKE_LIMIT} ครั้ง — คุณยังเข้าใช้งาน ดูสินค้า และลงขายสินค้าได้ตามปกติ`
              : `หากครบ ${STRIKE_LIMIT} ครั้ง จะถูกระงับสิทธิ์การเสนอราคา (แต่ยังซื้อขายด้านอื่นได้ตามปกติ)`}
          </p>
        </section>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-ink/60">
          คุณยังไม่เคยเสนอราคาสินค้าใด
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const myBid = item.bids[0];
            const won = item.winnerId === user.id;
            const paid = item.paymentState === "paid";
            const lastPayment = item.payments[0];

            const outcome = won
              ? paid
                ? { text: "ชนะ · ชำระเงินแล้ว", tone: "good" as const }
                : item.paymentDueAt && item.paymentDueAt.getTime() > now
                  ? { text: "ชนะ · รอชำระเงิน", tone: "warn" as const }
                  : { text: "ชนะ · เกินกำหนดชำระ", tone: "bad" as const }
              : item.status === "active"
                ? { text: "กำลังประมูล", tone: "plain" as const }
                : paid || item.paymentState === "unpaid"
                  ? { text: "ไม่ได้เป็นผู้ชนะ", tone: "plain" as const }
                  : { text: "จบแล้ว", tone: "plain" as const };

            return (
              <li
                key={item.id}
                className="flex flex-col gap-1 rounded-xl bg-white p-4 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/auctions/${item.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </Link>
                  <Badge tone={outcome.tone}>{outcome.text}</Badge>
                </div>
                <p className="text-ink/70">
                  เสนอราคาสูงสุดของคุณ{" "}
                  {myBid ? formatBaht(myBid.amount) : "-"} · ราคาปิด{" "}
                  {formatBaht(item.currentPrice)}
                </p>
                <p className="text-xs text-ink/55">
                  {lastPayment?.paidAt
                    ? `ชำระเมื่อ ${formatThaiDateTime(lastPayment.paidAt)}`
                    : won && !paid && item.paymentDueAt
                      ? `ชำระภายใน ${formatThaiDateTime(item.paymentDueAt)}`
                      : item.endedAt
                        ? `จบเมื่อ ${formatThaiDateTime(item.endedAt)}`
                        : ""}
                </p>
                {won && !paid && item.paymentDueAt &&
                item.paymentDueAt.getTime() > now ? (
                  <Link
                    href={`/auctions/${item.id}/pay`}
                    className={`${btnPrimarySm} mt-1 self-start`}
                  >
                    ชำระเงิน
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "good" | "warn" | "bad" | "plain";
  children: React.ReactNode;
}) {
  const styles = {
    good: "bg-green-600/15 text-green-800",
    warn: "bg-amber-600/15 text-amber-800",
    bad: "bg-red-600/15 text-brand-dark",
    plain: "bg-black/[0.06] text-ink/70",
  }[tone];

  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  );
}
