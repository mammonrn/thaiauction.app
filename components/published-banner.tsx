"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * "Your item is up" — shown once, immediately after publishing.
 *
 * Whether to show it is decided on the server, from `?published=1` set by
 * whichever route published the listing. That query string would otherwise
 * survive a reload and keep congratulating the seller, so it is stripped from
 * the address bar on mount: replaceState, so there is no navigation and no new
 * history entry, and a refresh then renders the ordinary page.
 *
 * The effect only updates the address bar — an external system — and never
 * this component's own state; the banner stays up for this view because the
 * server already decided it should, and is gone from the next one.
 */
export function PublishedBanner({ show }: { show: boolean }) {
  useEffect(() => {
    if (!show) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("published") === null) return;
    url.searchParams.delete("published");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [show]);

  if (!show) return null;

  return (
    // An inline link rather than a button, so the bar stays one line at 390px;
    // it inherits the success colour, matching the "ดูหน้าสาธารณะ" link in the
    // draft editor's own success bar rather than putting brand red inside a
    // green one.
    <p
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-success/35 bg-success/12 px-4 py-2.5 text-sm text-success"
    >
      เผยแพร่แล้ว — สินค้าของคุณขึ้นประมูลแล้ว
      <Link href="/" className="underline underline-offset-4">
        กลับหน้าแรก
      </Link>
    </p>
  );
}
