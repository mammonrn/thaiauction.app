import Image from "next/image";
import Link from "next/link";

import { PriceWindow } from "@/components/price-window";
import { imageUrl } from "@/lib/image-keys";
import type { ListingCard as Listing } from "@/lib/listing";
import { isClosingSoon, timeLeft } from "@/lib/time-left";

/**
 * One auction, as a ticket.
 *
 * The card is literally shaped like a stub: the photograph on top, a
 * perforated tear line, then what it costs you. The notch is not edge
 * decoration — it marks the seam between the two halves, which is a real
 * division in the content.
 *
 * The card must not clip its overflow or the notches would be cut off, so the
 * image gets its own rounded wrapper instead.
 *
 * `now` is passed in rather than read here: one clock per page keeps every
 * card on the grid consistent, and keeps this component pure.
 */
export function ListingCard({
  item,
  now,
  notchColor,
}: {
  item: Listing;
  now: Date;
  notchColor?: string;
}) {
  const cover = item.images[0];
  const urgent = isClosingSoon(item.endTime, now);

  return (
    <article className="group relative flex h-full flex-col rounded-lg bg-white shadow-[0_1px_3px_rgb(0_0_0/0.08)] transition-shadow hover:shadow-[0_4px_14px_rgb(0_0_0/0.13)]">
      <Link href={`/auctions/${item.id}`} className="flex h-full flex-col">
        <div className="relative aspect-square overflow-hidden rounded-t-lg bg-black/5">
          {cover ? (
            <Image
              src={imageUrl(cover)}
              alt=""
              fill
              sizes="(min-width: 1024px) 220px, (min-width: 640px) 30vw, 45vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              unoptimized
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-ink/40">
              ไม่มีรูปภาพ
            </div>
          )}

          {urgent ? (
            <span className="absolute left-0 top-2 rounded-r bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">
              ใกล้ปิด
            </span>
          ) : null}
        </div>

        <div
          className="ticket-seam"
          style={
            notchColor
              ? ({ "--notch-color": notchColor } as React.CSSProperties)
              : undefined
          }
        />

        <div className="flex flex-1 flex-col gap-2 p-3">
          <h3 className="line-clamp-2 text-sm leading-snug text-ink">
            {item.title}
          </h3>

          <div className="mt-auto flex flex-col gap-2">
            <PriceWindow satang={item.currentPrice} size="sm" />

            <div className="flex items-center justify-between gap-2 text-[11px] text-ink/55">
              <span className="truncate">{item.category.name}</span>
              <span
                className={urgent ? "font-semibold text-brand" : undefined}
                title={item.endTime?.toISOString()}
              >
                {timeLeft(item.endTime, now)}
              </span>
            </div>

            <span className="text-[11px] text-ink/45">
              {item._count.bids > 0
                ? `${item._count.bids} ครั้งที่เสนอราคา`
                : "ยังไม่มีผู้เสนอราคา"}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
