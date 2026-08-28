"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mobile tab bar.
 *
 * Thai shoppers arrive from Shopee and Lazada, where the primary actions live
 * at the bottom within thumb reach. Hiding "ลงขาย" behind a hamburger would
 * bury the one action that grows the marketplace.
 *
 * Hidden from sm: upwards, where the header already carries these links.
 * `pb-[env(safe-area-inset-bottom)]` keeps it clear of the iPhone home bar.
 */
const TABS = [
  { href: "/", label: "หน้าแรก", icon: HomeIcon },
  { href: "/search", label: "ค้นหา", icon: SearchIcon },
  { href: "/sell/new", label: "ลงขาย", icon: SellIcon },
  { href: "/account", label: "บัญชี", icon: UserIcon },
] as const;

export function BottomNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนูหลัก"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <ul className="flex">
        {TABS.map(({ href, label, icon: Icon }) => {
          // Signed-out visitors go to login rather than a page that redirects.
          const target = href === "/account" && !signedIn ? "/login" : href;
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);

          return (
            <li key={href} className="flex-1">
              <Link
                href={target}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors ${
                  active ? "text-brand" : "text-ink/55"
                }`}
              >
                <Icon />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
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

/** A tag with a hole — the same ticket idiom as the listing cards. */
function SellIcon() {
  return (
    <svg viewBox="0 0 22 22" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="M11.5 3H19v7.5l-8.2 8.2a1.5 1.5 0 0 1-2.1 0l-5.4-5.4a1.5 1.5 0 0 1 0-2.1L11.5 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="15.5" cy="6.5" r="1.4" fill="currentColor" />
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
