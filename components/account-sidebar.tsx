"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Account navigation, Shopee-style.
 *
 * Desktop only. On a phone the /account index page IS this menu, which is how
 * Shopee itself behaves — a persistent sidebar on a 390px screen would leave
 * no room for the thing it navigates to.
 *
 * Grouped by what the person is trying to do rather than by which table the
 * data lives in: buying, selling, then the account itself.
 */
const GROUPS = [
  {
    heading: "การซื้อ",
    links: [
      { href: "/account/bids", label: "ประวัติการประมูล" },
      { href: "/account/addresses", label: "ที่อยู่จัดส่ง" },
    ],
  },
  {
    heading: "การขาย",
    links: [
      { href: "/account/verification", label: "ยืนยันตัวตนผู้ขาย" },
      { href: "/account/bank", label: "บัญชีธนาคาร" },
      { href: "/sell", label: "สินค้าของฉัน" },
    ],
  },
  {
    heading: "บัญชี",
    links: [
      { href: "/account/phone", label: "เบอร์โทรศัพท์" },
      { href: "/account/security", label: "ความปลอดภัย" },
    ],
  },
] as const;

export function AccountSidebar({
  name,
  email,
  unpaidWins,
}: {
  name: string;
  email: string;
  /** Won auctions still to be paid for; puts a dot on ประวัติการประมูล. */
  unpaidWins: number;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนูบัญชี"
      className="hidden w-56 shrink-0 flex-col gap-6 sm:flex"
    >
      <Link
        href="/account"
        className="flex flex-col gap-0.5 rounded-xl bg-white p-4"
      >
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="truncate text-xs text-ink/55">{email}</span>
      </Link>

      {GROUPS.map((group) => (
        <div key={group.heading} className="flex flex-col gap-1">
          <span className="px-3 text-xs font-semibold uppercase tracking-wide text-ink/45">
            {group.heading}
          </span>
          {group.links.map((link) => {
            const active = pathname === link.href;
            const dot = link.href === "/account/bids" && unpaidWins > 0;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-brand/10 font-semibold text-brand"
                    : "text-ink/70 hover:bg-black/[.04] hover:text-ink"
                }`}
              >
                {link.label}
                {/* Same mark as the phone tab bar, so the two navigations
                    agree about what an unpaid win looks like. */}
                {dot ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full bg-brand"
                    />
                    <span className="sr-only">(มีรายการที่ต้องชำระเงิน)</span>
                  </>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
