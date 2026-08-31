import Image from "next/image";
import Link from "next/link";

import { btnPrimary } from "@/lib/button";
import { conditionLabel } from "@/lib/condition";
import { thumbUrl } from "@/lib/image-keys";
import { formatBaht } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { timeLeft } from "@/lib/time-left";
import { ShippingForm } from "@/components/shipping-form";
import { formatShipTo, shipToOf } from "@/lib/shipping";
import {
  STAGE_LABEL,
  STAGE_ORDER,
  sellerDashboard,
  type SellerDashboard,
} from "@/lib/seller-dashboard";
import { FailedDealCard } from "@/components/failed-deal-card";
import { failedDeals, type FailedDeal } from "@/lib/failed-deal";
import { formatThaiDateTime } from "@/lib/thai-datetime";

export const metadata = { title: "สินค้าของฉัน" };

/**
 * A seller's own listings.
 *
 * Every row used to carry the same six facts at the same weight — category,
 * price, bid count, two buttons — so nothing stood out and the one question a
 * seller actually opens this page with ("what needs me?") took reading all of
 * them. Grouping by status answers it before anything is read: live auctions
 * are the ones with money moving, drafts are the ones waiting on the seller,
 * finished ones are history.
 *
 * The whole card is the link. Two buttons per row were competing for a tap
 * target on a phone, and "จัดการ" and "ดูหน้าสาธารณะ" are the same intent —
 * open the thing — one screen apart.
 *
 * Above the list is the answer to the question the list cannot answer at a
 * glance: what needs the seller today, and what has the selling actually paid.
 * The order of the page is the order of the urgency — the orders somebody has
 * paid for and is waiting on, then the rest of the states, then the money, then
 * the full list underneath, which is unchanged.
 *
 * Access is exactly what it was: a session, and nothing else. Somebody who has
 * not passed KYC still reaches this page and still sees the empty state — the
 * gate is on listing, at /sell/new, and moving it here would lock people out of
 * a page that has never been locked.
 */
/**
 * Sold-and-unposted is first, and is the one group that is not a listing
 * status: it is the only one where somebody is waiting on the seller to do
 * something in the physical world. Everything below it is either running by
 * itself or already over.
 */
const GROUPS = [
  { key: "to_ship", title: "ขายแล้ว รอจัดส่ง" },
  { key: "active", title: "กำลังประมูล" },
  { key: "draft", title: "ฉบับร่าง" },
  { key: "ended", title: "จบแล้ว" },
  { key: "cancelled", title: "ยกเลิก" },
] as const;

export default async function SellPage() {
  const { user } = await requireSession("/sell");

  // One clock for the page, so every row measures its remaining time — and the
  // dashboard its thirty days — against the same instant.
  const now = new Date();
  const dashboard = await sellerDashboard(user.id, now);
  // Only asked for when there is one, so the common page costs nothing.
  const deals =
    dashboard.stages.failed > 0 ? await failedDeals(user.id) : ([] as FailedDeal[]);

  const items = await prisma.auctionItem.findMany({
    where: { sellerId: user.id },
    orderBy: [{ endTime: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      images: true,
      currentPrice: true,
      status: true,
      condition: true,
      endTime: true,
      paymentState: true,
      shippingStatus: true,
      trackingNumber: true,
      shipToName: true,
      shipToPhone: true,
      shipToLine: true,
      shipToSubDistrict: true,
      shipToDistrict: true,
      shipToProvince: true,
      shipToPostalCode: true,
      _count: { select: { bids: true } },
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">สินค้าของฉัน</h1>
        <Link href="/sell/new" className={btnPrimary}>
          ลงสินค้าใหม่
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/20 px-5 py-12 text-center">
          <p className="font-medium">ยังไม่มีสินค้า</p>
          <p className="mt-1 text-sm text-ink/60">
            กด “ลงสินค้าใหม่” เพื่อเริ่มลงประมูลชิ้นแรก
          </p>
        </div>
      ) : (
        <>
          <ToShip dashboard={dashboard} />
          <FailedDeals deals={deals} />
          <Stages dashboard={dashboard} />
          <Earnings dashboard={dashboard} />
        </>
      )}

      {items.length === 0 ? null : (
        GROUPS.map(({ key, title }) => {
          // A paid order still to be posted leaves the "จบแล้ว" pile and moves
          // to the top, so the seller never has to work out which of their
          // finished auctions are waiting on them.
          const group = items.filter((item) =>
            key === "to_ship"
              ? item.paymentState === "paid" && item.shippingStatus === "not_shipped"
              : item.status === key &&
                !(item.paymentState === "paid" && item.shippingStatus === "not_shipped"),
          );
          if (group.length === 0) return null;

          return (
            <section
              key={key}
              // The tile above links here rather than to a page of its own: the
              // tracking box is already attached to these rows, and a second
              // screen to reach it would be a second place to keep working.
              id={key === "to_ship" ? "to-ship" : undefined}
              className="flex flex-col gap-2 scroll-mt-20"
            >
              <h2 className="flex items-baseline gap-2 text-sm font-semibold text-ink/70">
                {title}
                <span className="text-xs font-normal text-ink/45">
                  {group.length}
                </span>
              </h2>

              <ul className="flex flex-col gap-2">
                {group.map((item) => (
                  <li
                    key={item.id}
                    className={
                      key === "to_ship" || item.shippingStatus === "shipped"
                        ? "flex flex-col rounded-xl bg-white p-3"
                        : undefined
                    }
                  >
                    <Link
                      href={`/sell/${item.id}/edit`}
                      className={
                        key === "to_ship" || item.shippingStatus === "shipped"
                          ? "flex items-center gap-3 transition-colors"
                          : "flex items-center gap-3 rounded-xl bg-white p-3 transition-colors hover:bg-brand/[.03]"
                      }
                    >
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-black/5">
                        {item.images[0] ? (
                          <Image
                            src={thumbUrl(item.images[0])}
                            alt=""
                            fill
                            sizes="64px"
                            className="object-cover"
                            unoptimized
                          />
                        ) : (
                          <span className="flex h-full items-center justify-center text-[10px] text-ink/40">
                            ไม่มีรูป
                          </span>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">
                          {item.title}
                        </span>
                        <span className="font-mono text-sm tabular-nums text-brand">
                          {formatBaht(item.currentPrice)}
                        </span>
                        {/* One line of context, and only the parts that differ
                            between rows: bids matter while it is live, the
                            condition matters while it is still being written. */}
                        <span className="truncate text-[11px] text-ink/50">
                          {key === "active"
                            ? `${item._count.bids} การเสนอราคา · ${timeLeft(item.endTime, now)}`
                            : key === "draft"
                              ? `${conditionLabel(item.condition)} · ${item.images.length} รูป`
                              : `${item._count.bids} การเสนอราคา`}
                        </span>
                      </div>

                      <span aria-hidden="true" className="shrink-0 text-ink/30">
                        →
                      </span>
                    </Link>

                    {/* Attached to the row rather than a page of its own: the
                        address and the tracking box belong next to the thing
                        being posted. Also shown on already-shipped orders, so
                        a mistyped number can be corrected. */}
                    {item.paymentState === "paid" ? (
                      <ShippingForm
                        order={{
                          itemId: item.id,
                          shippingStatus: item.shippingStatus,
                          trackingNumber: item.trackingNumber,
                          shipTo: (() => {
                            const address = shipToOf(item);
                            return address
                              ? {
                                  recipientName: address.recipientName,
                                  phone: address.phone,
                                  line: formatShipTo(address),
                                }
                              : null;
                          })(),
                        }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </main>
  );
}

/**
 * Deals that fell through, and are waiting on a decision.
 *
 * Second only to the shipping queue, and above everything else, because until
 * this existed these items simply stopped: lib/bidding.ts had struck everyone
 * who could be struck and run out of bidders to hand it to, and the listing sat
 * there with nobody told and nothing to press. Now the seller is told, and has
 * the two ways out — offer it on, or list it again.
 *
 * Rendered only when there is one. A section that says "no failed deals" on a
 * page about selling is a section about failure.
 */
function FailedDeals({ deals }: { deals: FailedDeal[] }) {
  if (deals.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold text-ink/70">
        ดีลล้ม รอตัดสินใจ
        <span className="text-xs font-normal text-ink/45">{deals.length}</span>
      </h2>

      <ul className="flex flex-col gap-2">
        {deals.map((deal) => (
          <FailedDealCard
            key={deal.itemId}
            deal={{
              itemId: deal.itemId,
              title: deal.title,
              lastPrice: deal.lastPrice,
              offer: deal.offer
                ? {
                    amount: deal.offer.amount,
                    // Formatted on the server, through the same helper every
                    // other date in the app goes through.
                    expiresLabel: formatThaiDateTime(deal.offer.expiresAt),
                  }
                : null,
              candidateAmount: deal.candidate?.amount ?? null,
            }}
            relistHref={`/sell/relist/${deal.itemId}`}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * The one queue that is somebody waiting on the seller.
 *
 * Given the treatment the admin index gives its queues, and for the same
 * reason: the count is the subject, so it is set in the mono face at display
 * size, and it is brand red only while there is something in it. At zero it
 * goes quiet rather than disappearing — a queue that vanishes when it empties
 * is one a seller has to remember exists.
 *
 * It links to the group below rather than to a page of its own. The tracking
 * box is already attached to those rows.
 */
function ToShip({ dashboard }: { dashboard: SellerDashboard }) {
  const waiting = dashboard.stages.to_ship;

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">จ่ายแล้ว รอเราส่ง</span>
          <span className="flex items-baseline gap-1.5">
            <span
              className={`font-mono text-3xl font-semibold tabular-nums ${
                waiting > 0 ? "text-brand" : "text-ink/30"
              }`}
            >
              {waiting}
            </span>
            <span className="text-xs text-ink/50">รายการ</span>
          </span>
          <span className="text-xs text-ink/55">
            {waiting === 0
              ? "ไม่มีรายการค้างส่ง"
              : "ผู้ซื้อจ่ายแล้ว รอเรากรอกเลขพัสดุ"}
          </span>
        </div>

        {waiting > 0 ? (
          <a href="#to-ship" className={btnPrimary}>
            ไปกรอกเลขพัสดุ
          </a>
        ) : null}
      </div>

      {/* The next deadline, on the one line it deserves. A seller with three
          auctions running does not need three countdowns up here; they need to
          know which one is next. */}
      {dashboard.closingSoon ? (
        <p className="border-t border-black/[.06] pt-3 text-xs text-ink/60">
          ประมูลที่ใกล้จบที่สุด:{" "}
          <Link
            href={`/sell/${dashboard.closingSoon.id}/edit`}
            className="text-info underline-offset-4 hover:underline"
          >
            {dashboard.closingSoon.title}
          </Link>{" "}
          · ปิด {formatThaiDateTime(dashboard.closingSoon.endTime)}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Every stage, as a row of counts.
 *
 * Ink, not colour. These are states, not alarms — the one thing that is
 * actually waiting on the seller is the tile above, and painting five numbers
 * in five colours would take the emphasis off it.
 */
function Stages({ dashboard }: { dashboard: SellerDashboard }) {
  return (
    <section className="rail -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0">
      {/* Every stage EXCEPT the queue, which the tile above already is. Both
          would put the same number on the same screen twice, and the second
          one would quietly take emphasis off the first. */}
      {STAGE_ORDER.filter((stage) => stage !== "to_ship").map((stage) => (
        <div
          key={stage}
          className="flex min-w-[7.5rem] shrink-0 flex-col gap-0.5 rounded-xl bg-white px-4 py-3 sm:min-w-0"
        >
          <span className="font-mono text-xl font-semibold tabular-nums">
            {dashboard.stages[stage]}
          </span>
          <span className="text-[11px] leading-tight text-ink/55">
            {STAGE_LABEL[stage]}
          </span>
        </div>
      ))}
    </section>
  );
}

/**
 * What the selling has actually paid.
 *
 * A statement that runs down to a rule, the same shape the payout breakdown and
 * the admin sales report use: the reader's question is "does the bottom line
 * follow from the top one?", and a column answers it by being read.
 *
 * Every figure is READ from the payment row, never worked out here — see
 * lib/seller-dashboard.ts. "รายรับ" throughout, never "กำไร": this knows what
 * the marketplace deducted and nothing about what the goods cost the seller.
 */
function Earnings({ dashboard }: { dashboard: SellerDashboard }) {
  const { earnings, last30 } = dashboard;

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-medium">รายรับจากการขาย</h2>
        <span className="text-xs text-ink/50">
          {earnings.count === 0
            ? "ยังไม่มีรายการที่ขายสำเร็จ"
            : `ขายสำเร็จ ${earnings.count.toLocaleString("th-TH")} รายการ`}
        </span>
      </div>

      {earnings.count === 0 ? (
        <p className="text-sm text-ink/60">
          เมื่อผู้ชนะชำระเงินแล้ว ยอดจะสรุปที่นี่
        </p>
      ) : (
        <>
          <dl className="flex flex-col text-sm">
            <Figure label="ยอดขายรวม" value={earnings.sales} />
            <Figure label="ค่าธรรมเนียม Omise" value={-earnings.omiseFee} indent />
            <Figure label="VAT ค่าธรรมเนียม" value={-earnings.omiseVat} indent />
            {/* Only when there is one. A zero line here would suggest a
                deduction that never happened — the manual payout path takes no
                transfer fee at all. */}
            {earnings.transferFee > 0 ? (
              <Figure label="ค่าโอนเงิน" value={-earnings.transferFee} indent />
            ) : null}
            <Figure label="ค่าคอมมิชชั่นแพลตฟอร์ม" value={-earnings.commission} indent />
            <Figure label="รายรับสุทธิของคุณ" value={earnings.net} total />
          </dl>

          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-black/[.06] pt-3 text-xs">
            <span className="flex items-baseline gap-1.5">
              <span className="text-ink/55">รอโอน</span>
              <span className="font-mono tabular-nums text-warning">
                {formatBaht(earnings.awaitingPayout)}
              </span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-ink/55">โอนแล้ว</span>
              <span className="font-mono tabular-nums text-success">
                {formatBaht(earnings.paidOut)}
              </span>
            </span>
          </div>

          {/* Thirty days, as a line rather than a second statement. A seller
              asking "how did this month go" wants one number, and the full
              breakdown for a window they cannot change is a table nobody reads. */}
          <p className="text-xs text-ink/55">
            30 วันล่าสุด: ขายสำเร็จ {last30.count.toLocaleString("th-TH")} รายการ ·
            ยอดขาย {formatBaht(last30.sales)} · รายรับสุทธิ {formatBaht(last30.net)}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * One line of the statement.
 *
 * Deductions carry their own minus sign and sit indented, so the column reads
 * as arithmetic rather than as a list of unrelated figures.
 */
function Figure({
  label,
  value,
  indent,
  total,
}: {
  label: string;
  value: number;
  indent?: boolean;
  total?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-1 ${
        total ? "mt-1 border-t border-black/10 pt-2 font-semibold" : ""
      }`}
    >
      <dt className={indent ? "pl-3 text-ink/60" : "text-ink/80"}>{label}</dt>
      <dd className="font-mono tabular-nums">
        {value < 0 ? `−${formatBaht(-value)}` : formatBaht(value)}
      </dd>
    </div>
  );
}
