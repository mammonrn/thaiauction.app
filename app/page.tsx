import Link from "next/link";

import { CountdownClock } from "@/components/countdown-clock";
import { ListingCard } from "@/components/listing-card";
import { ListingControls, Pagination } from "@/components/listing-controls";
import { thumbUrl } from "@/lib/image-keys";
import { formatBaht } from "@/lib/money";
import {
  findCategoriesWithCounts,
  findClosingSoon,
  findListings,
  parseSort,
  type ListingCard as Listing,
} from "@/lib/listing";
import Image from "next/image";
import { btnPrimarySm, btnSecondarySm } from "@/lib/button";

/**
 * The marketplace.
 *
 * The hero is not a banner. What is actually characteristic of an auction is
 * that time is running out, so the top of the page is the auctions closing
 * soonest, with their clocks running. It is the most useful thing on the page
 * and the most honest statement of what the site is — a decorative carousel
 * would have been neither.
 */
export default async function HomePage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;

  const categorySlug = typeof params.cat === "string" ? params.cat : undefined;
  const sort = parseSort(typeof params.sort === "string" ? params.sort : undefined);
  const page = Math.max(1, Number(params.page) || 1);

  const [{ items, total, pageCount }, categories, closingSoon] =
    await Promise.all([
      findListings({ categorySlug, sort, page }),
      findCategoriesWithCounts(),
      // Only worth showing on the unfiltered first page; once someone is
      // filtering or paging they are browsing deliberately, and a rail of
      // unrelated items is in the way.
      categorySlug || page > 1 ? Promise.resolve([]) : findClosingSoon(),
    ]);

  // One clock for the whole page, so no two cards disagree about "เหลือ 2 ชม.".
  const now = new Date();

  return (
    <main className="flex-1 pb-8">
      {closingSoon.length > 0 ? (
        <ClosingSoonRail items={closingSoon} now={now} />
      ) : null}

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-5">
          {/* Nothing to sort and nothing to filter: an empty marketplace should
              offer the one action that fixes it, not a row of dead controls. */}
          {items.length > 0 || categorySlug ? (
            <ListingControls
              basePath="/"
              categories={categories}
              activeCategory={categorySlug}
              sort={sort}
            />
          ) : null}

          {items.length === 0 ? (
            <EmptyState filtered={Boolean(categorySlug)} />
          ) : (
            <>
              <p className="text-xs text-ink/50">
                {total.toLocaleString("th-TH")} รายการกำลังประมูล
              </p>

              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
                {items.map((item) => (
                  <li key={item.id}>
                    <ListingCard item={item} now={now} />
                  </li>
                ))}
              </ul>

              <Pagination
                basePath="/"
                page={page}
                pageCount={pageCount}
                params={{ cat: categorySlug, sort: sort === "newest" ? undefined : sort }}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * The closing-soonest auctions, clocks running.
 *
 * A STRIP, not a screen. The first draft gave these cards the same weight as
 * the grid and the band swallowed the whole first viewport on a phone — the
 * rail is a pointer to the grid, so it has to stay smaller than the thing it
 * points at. The clock rides on the image as an overlay rather than taking a
 * row of its own.
 *
 * The band is INK, not brand-dark. On a 390px screen the red header plus a red
 * rail put a third of the first viewport under the accent colour, which is
 * where 60-30-10 breaks: the colour that is supposed to mark the one thing
 * worth looking at had become the ground. Ink is structure, so the band can be
 * as large as it needs to be, and it is the same dark-glass idiom the price
 * window already uses — gold figures on ink — rather than a second red.
 */
function ClosingSoonRail({ items, now }: { items: Listing[]; now: Date }) {
  return (
    <section className="bg-ink text-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-bold sm:text-base">ปิดเร็วๆ นี้</h2>
          <Link
            href="/?sort=ending"
            className="text-xs text-white/80 underline-offset-4 hover:underline"
          >
            ดูทั้งหมด
          </Link>
        </div>

        <ul className="rail -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:gap-3 sm:px-0">
          {items.map((item) => (
            <li key={item.id} className="w-28 shrink-0 sm:w-32">
              <Link
                href={`/auctions/${item.id}`}
                className="group flex flex-col gap-1.5"
              >
                <div className="relative aspect-square overflow-hidden rounded-md bg-white/[.08]">
                  {item.images[0] ? (
                    <Image
                      src={thumbUrl(item.images[0])}
                      alt=""
                      fill
                      sizes="(min-width: 640px) 128px, 112px"
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                      unoptimized
                    />
                  ) : null}
                  {item.endTime ? (
                    <span className="absolute inset-x-0 bottom-0 flex justify-center bg-black/70 py-0.5">
                      <CountdownClock
                        endsAt={item.endTime.toISOString()}
                        serverNow={now.toISOString()}
                      />
                    </span>
                  ) : null}
                </div>
                <p className="line-clamp-1 text-[11px] text-white/85">
                  {item.title}
                </p>
                {/* Plain gold type, not the price window. The window is
                    reserved for where the PRICE is the decision — the grid and
                    the item page. Here the decision is time, which is why the
                    clock got the dark housing instead. It also cannot overflow
                    a 112px card the way a boxed seven-figure baht value would. */}
                <span className="font-mono text-xs font-semibold tabular-nums text-gold">
                  {formatBaht(item.currentPrice)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** An empty screen is an invitation to act, not an apology. */
function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-white px-6 py-16 text-center">
      <p className="text-base font-medium">
        {filtered
          ? "หมวดนี้ยังไม่มีสินค้าที่กำลังประมูล"
          : "ยังไม่มีสินค้าที่กำลังประมูลตอนนี้"}
      </p>
      <p className="max-w-sm text-sm text-ink/60">
        {filtered
          ? "ลองดูหมวดอื่น หรือลงขายสินค้าในหมวดนี้เป็นคนแรก"
          : "เป็นคนแรกที่ลงขาย แล้วสินค้าของคุณจะได้อยู่หน้าแรกคนเดียว"}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {filtered ? (
          <Link
            href="/"
            className={btnSecondarySm}
          >
            ดูสินค้าทั้งหมด
          </Link>
        ) : null}
        <Link
          href="/sell/new"
          className={btnPrimarySm}
        >
          ลงขายสินค้าชิ้นแรก
        </Link>
      </div>
    </div>
  );
}
