import Link from "next/link";

/**
 * "← กลับหน้าแอดมิน", on every admin sub-page.
 *
 * The admin area is reached by typing /admin — nothing in the public UI links
 * to it — so a sub-page opened from the index has exactly one history entry
 * behind it and the browser's own Back is the only route home. That worked
 * until /admin/verifications offered "← กลับหน้าแรก", which sent a reviewer
 * out of the admin area entirely and made Back feel broken.
 *
 * One component rather than a line per page, so the three tools cannot drift
 * apart on where "back" goes.
 */
export function AdminBackLink() {
  return (
    <Link
      href="/admin"
      className="text-sm text-ink/60 underline-offset-4 hover:underline"
    >
      ← กลับหน้าแอดมิน
    </Link>
  );
}
