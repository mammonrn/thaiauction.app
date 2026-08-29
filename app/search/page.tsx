import Link from "next/link";

import { ListingCard } from "@/components/listing-card";
import { ListingControls, Pagination } from "@/components/listing-controls";
import { btnPrimarySm } from "@/lib/button";
import {
  findCategoriesWithCounts,
  findListings,
  parseSort,
} from "@/lib/listing";

export const metadata = { title: "สินค้าทั้งหมด" };

/**
 * Search results — and, with no query, the whole catalogue.
 *
 * The bottom bar's second tab points here and is labelled "หมวดหมู่", so an
 * empty query has to land on something browsable. It used to land on a page
 * that said "type in the box above", which is a dead end reached by pressing a
 * button: the category chips and the grid were already built and were simply
 * withheld. Nothing about the MATCHING changed — `findListings` ignores an
 * empty `search`, so this is the same query the home grid runs.
 *
 * A substring match on the title, which is what the brief asks for and what
 * the data supports: Postgres has no Thai word segmentation, so a full-text
 * index would not tokenise Thai correctly anyway and would give worse results
 * than `contains` while costing far more to build. If this gets slow the
 * answer is a trigram index on `title`, not a bigger query.
 *
 * The same category and sort controls as the home grid, so the two pages
 * behave identically once a browser is in them.
 */
export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const categorySlug = typeof params.cat === "string" ? params.cat : undefined;
  const sort = parseSort(typeof params.sort === "string" ? params.sort : undefined);
  const page = Math.max(1, Number(params.page) || 1);

  const [{ items, total, pageCount }, categories] = await Promise.all([
    // An empty `search` is no filter at all, which is exactly the browse view.
    findListings({ search: q || undefined, categorySlug, sort, page }),
    findCategoriesWithCounts(),
  ]);

  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-8 sm:px-6">
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-bold sm:text-xl">
            {q ? (
              <>
                ผลการค้นหา <span className="text-brand">{q}</span>
              </>
            ) : (
              "สินค้าทั้งหมด"
            )}
          </h1>
          {items.length > 0 ? (
            <p className="text-xs text-ink/50">
              {q
                ? `พบ ${total.toLocaleString("th-TH")} รายการ`
                : `${total.toLocaleString("th-TH")} รายการกำลังประมูล`}
            </p>
          ) : null}
        </header>

        {items.length > 0 || categorySlug ? (
          <ListingControls
            basePath="/search"
            categories={categories}
            activeCategory={categorySlug}
            sort={sort}
            extraParams={{ q }}
          />
        ) : null}

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-white px-6 py-16 text-center">
            {q ? (
              <>
                <p className="text-sm text-ink/70">
                  ไม่พบสินค้าที่ตรงกับ “{q}”
                </p>
                <p className="text-xs text-ink/50">
                  ลองใช้คำที่สั้นลง หรือดูตามหมวดหมู่แทน
                </p>
                <Link href="/search" className={btnPrimarySm}>
                  ดูสินค้าทั้งหมด
                </Link>
              </>
            ) : categorySlug ? (
              <>
                <p className="text-sm text-ink/70">
                  หมวดนี้ยังไม่มีสินค้าที่กำลังประมูล
                </p>
                <Link href="/search" className={btnPrimarySm}>
                  ดูสินค้าทั้งหมด
                </Link>
              </>
            ) : (
              <>
                <p className="text-sm text-ink/70">
                  ยังไม่มีสินค้าที่กำลังประมูลตอนนี้
                </p>
                <Link href="/sell/new" className={btnPrimarySm}>
                  ลงขายสินค้า
                </Link>
              </>
            )}
          </div>
        ) : null}

        {items.length > 0 ? (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
              {items.map((item) => (
                <li key={item.id}>
                  <ListingCard item={item} now={now} />
                </li>
              ))}
            </ul>

            <Pagination
              basePath="/search"
              page={page}
              pageCount={pageCount}
              params={{
                q,
                cat: categorySlug,
                sort: sort === "newest" ? undefined : sort,
              }}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
