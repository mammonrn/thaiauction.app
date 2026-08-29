import Link from "next/link";

import { InstallApp } from "@/components/install-app";

/**
 * Site footer — one line, and the last thing on the page.
 *
 * It was a white slab sitting directly above the tab bar, which on a phone put
 * a legal link and an install prompt between the reader and whatever they came
 * to do. A footer is a destination for someone already looking for it, not
 * something to walk past.
 *
 * The privacy link stays here rather than only on the account page: the
 * account page is behind a login, and PDPA expects the disclosure to be
 * reachable by anyone. This is the only surface on every page.
 *
 * `pb` clears the fixed tab bar on mobile, and the iPhone home bar under it.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-black/[.07] bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-[calc(3.75rem+env(safe-area-inset-bottom))] pt-2.5 text-[11px] text-ink/45 sm:px-6 sm:pb-2.5">
        <span className="font-medium text-ink/60">ThaiAuction</span>
        <Link href="/privacy" className="underline-offset-4 hover:underline">
          นโยบายความเป็นส่วนตัว
        </Link>
        {/* Renders nothing on desktop browsers that cannot install, and
            nothing inside an already-installed copy. */}
        <InstallApp />
      </div>
    </footer>
  );
}
