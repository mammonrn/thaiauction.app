import Link from "next/link";

/**
 * Site footer.
 *
 * Exists mainly to carry the privacy policy link. PDPA expects the disclosure
 * to be findable, and a link only on the sign-up page would not be — people
 * agree to things there without reading and never see it again.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-black/10 px-6 py-8 dark:border-white/15">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 text-sm text-black/60 dark:text-white/60">
        <span>thai-auction</span>
        <Link href="/privacy" className="underline-offset-4 hover:underline">
          นโยบายความเป็นส่วนตัว
        </Link>
      </div>
    </footer>
  );
}
