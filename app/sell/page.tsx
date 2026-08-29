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

  // One clock for the page, so every row measures its remaining time against
  // the same instant.
  const now = new Date();

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
            <section key={key} className="flex flex-col gap-2">
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
