import Link from "next/link";

import { SORTS, type SortKey } from "@/lib/listing";

/**
 * Category chips and sort order.
 *
 * Both are plain links that rewrite the query string, not client state. That
 * keeps every view shareable and back-button-correct, and it means the filters
 * work with JavaScript still loading — which on a Thai mobile connection is
 * most of the first second.
 */
export function ListingControls({
  basePath,
  categories,
  activeCategory,
  sort,
  extraParams,
}: {
  basePath: string;
  categories: { name: string; slug: string; _count: { auctionItems: number } }[];
  activeCategory?: string;
  sort: SortKey;
  extraParams?: Record<string, string | undefined>;
}) {
  const href = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...extraParams, ...params })) {
      if (value) search.set(key, value);
    }
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="flex flex-col gap-3">
      {categories.length > 0 ? (
        <div className="rail -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          <Chip
            href={href({ cat: undefined, sort })}
            active={!activeCategory}
            label="ทั้งหมด"
          />
          {categories.map((category) => (
            <Chip
              key={category.slug}
              href={href({ cat: category.slug, sort })}
              active={activeCategory === category.slug}
              label={category.name}
              count={category._count.auctionItems}
            />
          ))}
        </div>
      ) : null}

      <div className="rail -mx-4 flex items-center gap-1 overflow-x-auto border-b border-black/10 px-4 sm:mx-0 sm:px-0">
        <span className="shrink-0 pr-2 text-xs text-ink/50">เรียงตาม</span>
        {(Object.keys(SORTS) as SortKey[]).map((key) => {
          const active = sort === key;
          return (
            <Link
              key={key}
              href={href({ cat: activeCategory, sort: key })}
              aria-current={active ? "true" : undefined}
              className={`shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${
                active
                  ? "border-brand font-semibold text-brand"
                  : "border-transparent text-ink/60 hover:text-ink"
              }`}
            >
              {SORTS[key]}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Chip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-black/12 bg-white text-ink/75 hover:border-brand/50 hover:text-brand"
      }`}
    >
      {label}
      {count !== undefined ? (
        <span className={active ? "ml-1.5 text-white/70" : "ml-1.5 text-ink/40"}>
          {count}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Page links.
 *
 * Numbered pages rather than infinite scroll: a browser can share or bookmark
 * "page 3", the back button returns them where they were, and nothing has to
 * hold a growing list in memory on a cheap phone. Infinite scroll would also
 * fight the footer, which carries the privacy link PDPA expects to be findable.
 */
export function Pagination({
  basePath,
  page,
  pageCount,
  params,
}: {
  basePath: string;
  page: number;
  pageCount: number;
  params: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    if (target > 1) search.set("page", String(target));
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  // A window around the current page, so 200 pages never render 200 links.
  const from = Math.max(1, Math.min(page - 2, pageCount - 4));
  const to = Math.min(pageCount, Math.max(page + 2, 5));
  const pages = [];
  for (let p = from; p <= to; p += 1) pages.push(p);

  return (
    <nav aria-label="หน้า" className="flex items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={href(page - 1)} className={pageLink(false)}>
          ก่อนหน้า
        </Link>
      ) : null}

      {pages.map((p) => (
        <Link
          key={p}
          href={href(p)}
          aria-current={p === page ? "page" : undefined}
          className={pageLink(p === page)}
        >
          {p}
        </Link>
      ))}

      {page < pageCount ? (
        <Link href={href(page + 1)} className={pageLink(false)}>
          ถัดไป
        </Link>
      ) : null}
    </nav>
  );
}

function pageLink(active: boolean): string {
  return `min-w-9 rounded-md border px-3 py-2 text-center text-sm transition-colors ${
    active
      ? "border-brand bg-brand font-semibold text-white"
      : "border-black/12 bg-white text-ink/70 hover:border-brand/50 hover:text-brand"
  }`;
}
