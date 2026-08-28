/**
 * Trust badges for a seller.
 *
 * The two are deliberately worded and coloured differently. A verified phone
 * means a number was proved reachable; a verified identity means a human
 * checked a government ID. Letting them read as the same thing would overstate
 * what the weaker one proves.
 */
export function SellerBadges({
  phoneVerified,
  identityVerified,
}: {
  phoneVerified: boolean;
  identityVerified: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {identityVerified ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-600/10 px-2 py-0.5 text-xs font-medium text-blue-700">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M10 1.5 3 4.3v5c0 4.2 2.9 8.1 7 9.2 4.1-1.1 7-5 7-9.2v-5L10 1.5Zm3.3 6.4-4 4a.8.8 0 0 1-1.1 0L6.7 10.4a.8.8 0 1 1 1.1-1.1l1 1 3.4-3.5a.8.8 0 1 1 1.1 1.1Z"
              clipRule="evenodd"
            />
          </svg>
          ยืนยันตัวตนแล้ว
        </span>
      ) : null}

      {phoneVerified ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-black/[.06] px-2 py-0.5 text-xs text-ink/70">
          ยืนยันเบอร์โทรแล้ว
        </span>
      ) : null}
    </span>
  );
}
