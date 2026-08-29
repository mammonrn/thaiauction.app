"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mobile tab bar.
 *
 * Thai shoppers arrive from Shopee and Lazada, where the primary actions live
 * at the bottom within thumb reach.
 *
 * "ลงขาย" is the action the marketplace exists to collect, and as a fourth
 * equal tab it read as a fourth equal option. It is now the centre of the bar
 * and the only filled thing in it — a raised disc that breaks the bar's top
 * edge, which is the one place a phone user's thumb rests naturally. Two tabs
 * either side keep the row balanced around it rather than making it look
 * off-centre.
 *
 * Hidden from sm: upwards, where the header already carries these links.
 * `pb-[env(safe-area-inset-bottom)]` keeps it clear of the iPhone home bar.
 */
const LEFT = [
  { href: "/", label: "หน้าแรก", icon: HomeIcon },
  { href: "/search", label: "ค้นหา", icon: SearchIcon },
] as const;

const RIGHT = [
  { href: "/account/bids", label: "ประมูลของฉัน", icon: GavelIcon },
  { href: "/account", label: "บัญชี", icon: UserIcon },
] as const;

export function BottomNav({
  signedIn,
  unpaidWins,
}: {
  signedIn: boolean;
  /** Won auctions still to be paid for; puts a dot on "ประมูลของฉัน". */
  unpaidWins: number;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // Signed-out visitors go to login rather than a page that redirects them
  // there a moment later.
  const target = (href: string) =>
    href.startsWith("/account") && !signedIn ? "/login" : href;

  return (
    <nav
      aria-label="เมนูหลัก"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <ul className="flex items-end">
        {LEFT.map((tab) => (
          <Tab key={tab.href} {...tab} active={isActive(tab.href)} href={target(tab.href)} />
        ))}

        {/* The disc sits in the flow rather than absolutely positioned, so it
            cannot drift out of the bar on a narrow screen; the negative margin
            is what lifts it past the top edge. */}
        <li className="flex w-20 shrink-0 flex-col items-center">
          <Link
            href={target("/sell/new")}
            aria-current={pathname.startsWith("/sell") ? "page" : undefined}
            className="-mt-5 flex flex-col items-center gap-1 pb-1.5"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-brand text-white shadow-[0_4px_12px_color-mix(in_srgb,var(--color-brand)_35%,transparent)] transition-colors active:bg-brand-dark">
              <PlusIcon />
            </span>
            <span className="text-[11px] font-medium text-brand">ลงขาย</span>
          </Link>
        </li>

        {RIGHT.map((tab) => (
          <Tab
            key={tab.href}
            {...tab}
            active={isActive(tab.href)}
            href={target(tab.href)}
            // Only for someone who is signed in and actually owes: a dot that
            // sends a signed-out visitor to the login page is a lie.
            dot={signedIn && tab.href === "/account/bids" && unpaidWins > 0}
          />
        ))}
      </ul>
    </nav>
  );
}

function Tab({
  href,
  label,
  icon: Icon,
  active,
  dot = false,
}: {
  href: string;
  label: string;
  icon: () => React.ReactElement;
  active: boolean;
  dot?: boolean;
}) {
  return (
    <li className="min-w-0 flex-1">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] transition-colors ${
          active ? "text-brand" : "text-ink/55"
        }`}
      >
        {/* The dot rides on the icon, not the row, so it reads as marking
            this tab rather than floating between two of them. Brand, because
            an unpaid win is something to act on — the status colours are for
            saying what has already happened. */}
        <span className="relative">
          <Icon />
          {dot ? (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-brand ring-2 ring-white"
            />
          ) : null}
        </span>
        <span className="w-full truncate text-center">
          {label}
          {dot ? <span className="sr-only"> (มีรายการที่ต้องชำระเงิน)</span> : null}
        </span>
      </Link>
    </li>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 22 22" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="M3 9.5 11 3l8 6.5V18a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1V9.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 22 22" fill="none" className="h-5 w-5" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m15 15 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** The gavel from the mark, reduced to two strokes. */
function GavelIcon() {
  return (
    <svg viewBox="0 0 22 22" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="m5.5 10.5 5-5M8 13 13 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <rect x="9.4" y="3.6" width="8.5" height="4.2" rx="2.1" transform="rotate(45 9.4 3.6)" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 18.5h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 22 22" fill="none" className="h-5 w-5" aria-hidden="true">
      <circle cx="11" cy="7.5" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 19c0-3.6 3.1-6 7-6s7 2.4 7 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
