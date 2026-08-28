import Link from "next/link";

import { InstallApp } from "@/components/install-app";

/**
 * Site footer.
 *
 * Exists mainly to carry the privacy policy link. PDPA expects the disclosure
 * to be findable, and a link only on the sign-up page would not be — people
 * agree to things there without reading and never see it again.
 *
 * The bottom padding on mobile clears the fixed tab bar.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-black/10 bg-white px-4 pb-20 pt-8 sm:px-6 sm:pb-8">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink/60">
        <span className="font-medium text-ink/80">thaiauction</span>
        <Link href="/privacy" className="underline-offset-4 hover:underline">
          นโยบายความเป็นส่วนตัว
        </Link>
        <Link href="/sell/new" className="underline-offset-4 hover:underline">
          ลงขายสินค้า
        </Link>
        {/* Renders nothing on desktop browsers that cannot install, and
            nothing inside an already-installed copy. */}
        <InstallApp />
      </div>
    </footer>
  );
}
