import Link from "next/link";

import { CountdownClock } from "@/components/countdown-clock";
import { ListingCard } from "@/components/listing-card";
import { ListingControls, Pagination } from "@/components/listing-controls";
import { imageUrl } from "@/lib/image-keys";
import { formatBaht } from "@/lib/money";
import {
  findCategoriesWithCounts,
  findClosingSoon,
  findListings,
  parseSort,
  type ListingCard as Listing,
} from "@/lib/listing";
import Image from "next/image";

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
          <ListingControls
            basePath="/"
            categories={categories}
            activeCategory={categorySlug}
            sort={sort}
          />

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
 */
function ClosingSoonRail({ items, now }: { items: Listing[]; now: Date }) {
  return (
    <section className="bg-brand-dark text-white">
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
                <div className="relative aspect-square overflow-hidden rounded-md bg-white/10">
                  {item.images[0] ? (
                    <Image
                      src={imageUrl(item.images[0])}
                      alt=""
                      fill
                      sizes="(min-width: 640px) 128px, 112px"
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                      unoptimized
                    />
                  ) : null}
                  {item.endTime ? (
                    <span className="absolute inset-x-0 bottom-0 flex justify-center bg-ink/85 py-0.5">
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
      <p className="text-sm text-ink/70">
        {filtered
          ? "หมวดนี้ยังไม่มีสินค้าที่กำลังประมูล"
          : "ยังไม่มีสินค้าที่กำลังประมูลตอนนี้"}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {filtered ? (
          <Link
            href="/"
            className="rounded-md border border-black/12 bg-white px-4 py-2 text-sm text-ink/75 hover:border-brand/50 hover:text-brand"
          >
            ดูสินค้าทั้งหมด
          </Link>
        ) : null}
        <Link
          href="/sell/new"
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          ลงขายสินค้าชิ้นแรก
        </Link>
      </div>
    </div>
  );
}
