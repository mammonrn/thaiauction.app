import Link from "next/link";

import { InstallApp } from "@/components/install-app";

/**
 * Site footer.
 *
 * Deliberately quiet. The "ลงขายสินค้า" link that used to live here duplicated
 * the bottom tab bar's ลงขาย on every phone screen, and the privacy link was
 * set at body size next to the brand, which gave a legal document the same
 * weight as the product.
 *
 * The privacy link stays here even though the account page now carries it too:
 * PDPA expects the disclosure to be findable, and the account page is behind a
 * login. Signed-out visitors need a route to it, and this is the only surface
 * on every page. Less prominent, not absent.
 *
 * The bottom padding on mobile clears the fixed tab bar.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-black/10 bg-white px-4 pb-20 pt-6 sm:px-6 sm:pb-8">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink/50">
        <span className="font-medium text-ink/70">ThaiAuction</span>
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
