import Link from "next/link";
import { Suspense } from "react";

import { SearchInput } from "@/components/search-input";
import { getSession } from "@/lib/session";

/**
 * The header, on every page.
 *
 * Shopee's arrangement — mark left, search occupying the middle, actions right
 * — because it is what Thai shoppers already know, and familiarity is worth
 * more here than novelty. The search field is a plain GET form to /search, so
 * it works before any JavaScript loads; on a mobile connection that is the
 * difference between a usable header and a dead one.
 *
 * On phones the right-hand actions move to the bottom bar, where thumbs are.
 */
export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-40 bg-brand-dark text-white">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5 sm:gap-6 sm:px-6 sm:py-3">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2"
          aria-label="thaiauction หน้าแรก"
        >
          <GavelMark />
          <span className="hidden text-lg font-bold tracking-tight sm:inline">
            thai<span className="text-gold">auction</span>
          </span>
        </Link>

        <form action="/search" className="min-w-0 flex-1">
          <label htmlFor="site-search" className="sr-only">
            ค้นหาสินค้า
          </label>
          <div className="flex items-center overflow-hidden rounded-md bg-white">
            {/* useSearchParams needs a Suspense boundary; the fallback is the
                same field without a remembered value. */}
            <Suspense
              fallback={
                <input
                  id="site-search"
                  name="q"
                  type="search"
                  placeholder="ค้นหาสินค้าที่อยากประมูล"
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/45"
                />
              }
            >
              <SearchInput />
            </Suspense>
            <button
              type="submit"
              className="m-1 shrink-0 rounded bg-brand px-3 py-1.5 text-white transition-colors hover:bg-brand-dark"
              aria-label="ค้นหา"
            >
              <SearchIcon />
            </button>
          </div>
        </form>

        <nav className="hidden shrink-0 items-center gap-5 text-sm sm:flex">
          <Link
            href="/sell/new"
            className="font-medium underline-offset-4 hover:underline"
          >
            ลงขาย
          </Link>
          <Link
            href={session ? "/account" : "/login"}
            className="flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
          >
            <UserIcon />
            {session ? "บัญชีของฉัน" : "เข้าสู่ระบบ"}
          </Link>
        </nav>
      </div>
    </header>
  );
}

/**
 * The gavel from the master logo, reduced for 28px.
 *
 * Drawn inline rather than loading public/brand/logo.png, for two reasons. The
 * master is a red tile, and a second red on the dark-red header reads as a
 * smudge rather than a mark; white-on-red is the only version that holds. And
 * the master is drawn in outline — hairlines that turn to mush at header size —
 * so the reduction is solid shapes: head, handle, block. The arc is dropped
 * because at 28px it is a grey smear rather than a circle.
 *
 * Same silhouette as the app icon, so the two read as one mark.
 */
function GavelMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      className="h-7 w-7 shrink-0"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="rotate(-20 16 13)">
        <rect x="4" y="7" width="21" height="9" rx="4.5" />
        <rect x="12.5" y="15" width="4" height="10" rx="2" />
      </g>
      <rect x="3" y="26" width="26" height="4.5" rx="2.25" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2" />
      <path d="m13.5 13.5 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <circle cx="10" cy="6.5" r="3.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 17c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
