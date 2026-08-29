import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { SearchInput } from "@/components/search-input";
import { unreadNotificationCount } from "@/lib/notifications";
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
 * The bell sits at the right end on EVERY screen size, phones included. It was
 * a sixth tab in the bottom bar, which made the bar too long to read at 390px
 * and put a counter — something you glance at — in the row meant for the four
 * places you go. Up here it is where every other app keeps it, and the bottom
 * bar is back to four tabs plus the sell disc.
 *
 * On phones the remaining right-hand links move to the bottom bar, where
 * thumbs are.
 */
export async function SiteHeader() {
  const session = await getSession();
  // Signed-out visitors have nothing to count and get no bell, so this is not
  // a query per page view for a guaranteed zero.
  const unread = session ? await unreadNotificationCount(session.user.id) : 0;

  return (
    <header className="sticky top-0 z-40 bg-brand-dark text-white">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5 sm:gap-6 sm:px-6 sm:py-3">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2"
          aria-label="ThaiAuction หน้าแรก"
        >
          {/* The master logo itself, not a redrawn approximation: white
              artwork on transparency, so it sits on the brand-dark band
              without a plate of its own. Served at 4x for hairline outlines. */}
          <Image
            src="/brand/logo-mark.png"
            alt=""
            width={128}
            height={128}
            priority
            className="h-8 w-8 shrink-0"
          />
          {/* Plain white. Gold is the price readout and the focus ring; a
              wordmark is neither, and a logotype that borrows the money colour
              is how "reserved for one job" quietly becomes "used everywhere". */}
          <span className="hidden text-lg font-bold tracking-tight sm:inline">
            ThaiAuction
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

        {/* Rendered only when signed in, so a signed-out phone header is the
            logo and the search field and nothing else — no element, and so no
            gap either. */}
        {session ? (
          <Link
            href="/account/notifications"
            aria-label={
              unread > 0
                ? `การแจ้งเตือน — ${unread} รายการที่ยังไม่อ่าน`
                : "การแจ้งเตือน"
            }
            className="relative shrink-0 rounded-md p-2 transition-colors hover:bg-white/10"
          >
            <BellIcon />
            {unread > 0 ? (
              // Capped at 9+: the badge has to stay a badge, and past nine the
              // exact figure stops changing what anyone does about it. The
              // white ring is what cuts it out of the band — brand red on
              // brand-dark has too little edge to read on its own.
              <span
                aria-hidden="true"
                className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-medium leading-4 text-white ring-2 ring-white"
              >
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </Link>
        ) : null}

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

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2" />
      <path d="m13.5 13.5 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 22 22" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M11 3a5 5 0 0 0-5 5v3.2l-1.3 2.6a.6.6 0 0 0 .5.9h11.6a.6.6 0 0 0 .5-.9L16 11.2V8a5 5 0 0 0-5-5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9 17.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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
