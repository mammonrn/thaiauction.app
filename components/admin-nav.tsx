"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { btnGhost, btnSecondarySm } from "@/lib/button";

/**
 * Navigation for the admin area.
 *
 * The admin zone had no navigation of its own: every tool was reached from the
 * four tiles on /admin, and the three that were not tiles were text links in a
 * row underneath. Getting from the payout queue to the sales report meant going
 * back to the index first, which is why every sub-page carries an
 * "← กลับหน้าแอดมิน" link. A dashboard sidebar is the shape this wants — the
 * whole tool list visible from every tool, the way Omise's own dashboard does
 * it — and the index is then free to be what it always was: what is waiting.
 *
 * It carries LABELS AND PATHS AND NOTHING ELSE. No counts, no queue lengths, no
 * email — nothing that needs a query, and so nothing that could leak from the
 * shell. The four numbers still live on the index, where a number that changes
 * belongs on a page that re-renders.
 *
 * Grouped by what an admin is doing rather than by which table the rows are in:
 * work that is waiting, then people, then the figures.
 */
const GROUPS = [
  {
    heading: "คิวงาน",
    links: [
      { href: "/admin/verifications", label: "ตรวจสอบการยืนยันตัวตน" },
      { href: "/admin/payouts", label: "รอโอนให้ผู้ขาย" },
      { href: "/admin/reports", label: "สินค้าที่ถูกแจ้ง" },
      { href: "/admin/fraud", label: "สัญญาณน่าสงสัย" },
    ],
  },
  {
    heading: "ผู้ใช้",
    links: [
      { href: "/admin/members", label: "สมาชิกทั้งหมด" },
      { href: "/admin/bans", label: "บัญชีที่ถูกแบน" },
    ],
  },
  {
    heading: "รายงาน",
    links: [
      { href: "/admin/reports/sales", label: "รายงานยอดขาย" },
      { href: "/admin/referrals", label: "ชวนเพื่อน" },
    ],
  },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  /**
   * The drawer belongs to the page it was opened on.
   *
   * Held as "which page is it open over" rather than a boolean, so arriving
   * somewhere new closes it by simply no longer matching — going somewhere is
   * the entire point of the menu, and a drawer still hanging over the page it
   * just navigated away from is a bug. The alternative is an effect watching
   * the router to push state back the other way, which React asks you not to
   * write and which would run a render late.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const close = () => setOpenedAt(null);

  // A phone rotated into a wide viewport gets the permanent sidebar, and the
  // drawer would otherwise stay open-but-invisible with the body still locked.
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia("(min-width: 40rem)");
    const shut = () => {
      if (wide.matches) setOpenedAt(null);
    };
    wide.addEventListener("change", shut);
    return () => wide.removeEventListener("change", shut);
  }, [open]);

  return (
    <>
      {/* Phones: the way in. A row of its own above the page rather than a
          floating control over it — the header is already sticky, and a second
          thing pinned to the top of a 390px screen leaves the page reading
          through a letterbox. */}
      <div className="px-4 pt-5 sm:hidden">
        <button
          type="button"
          onClick={() => setOpenedAt(pathname)}
          aria-expanded={open}
          aria-controls="admin-drawer"
          className={btnSecondarySm}
        >
          <MenuIcon />
          เมนูแอดมิน
        </button>
      </div>

      <AdminDrawer open={open} onClose={close}>
        <Menu pathname={pathname} />
      </AdminDrawer>

      {/* From sm: upwards the same menu is simply always there. Sticky, so it
          survives a long payout queue: a nav you have to scroll back up to
          reach is a nav you stop using. */}
      <nav
        aria-label="เมนูแอดมิน"
        className="hidden w-60 shrink-0 flex-col self-start py-8 pl-6 sm:sticky sm:top-20 sm:flex"
      >
        <Menu pathname={pathname} />
      </nav>
    </>
  );
}

/**
 * The menu itself, drawn once and rendered in both places.
 *
 * The active row is the brand tint the account sidebar already uses. The app
 * gets one idea of what "you are here" looks like rather than a second one
 * invented for admins, and brand is right for it: it marks the thing you are
 * on, which is the only accent a list of eight quiet rows needs.
 */
function Menu({ pathname }: { pathname: string }) {
  return (
    <div className="flex flex-col gap-6">
      <Row href="/admin" label="ผู้ดูแลระบบ" pathname={pathname} />

      {GROUPS.map((group) => (
        <div key={group.heading} className="flex flex-col gap-1">
          <span className="px-3 text-xs font-semibold uppercase tracking-wide text-ink/45">
            {group.heading}
          </span>
          {group.links.map((link) => (
            <Row
              key={link.href}
              href={link.href}
              label={link.label}
              pathname={pathname}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * One tool.
 *
 * Matched exactly, not by prefix: /admin/reports and /admin/reports/sales are
 * two tools that happen to share a path, and a prefix match would light both
 * of them up on the sales report and leave an admin unsure which page they are
 * looking at.
 */
function Row({
  href,
  label,
  pathname,
}: {
  href: string;
  label: string;
  pathname: string;
}) {
  const active = pathname === href;

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-brand/10 font-semibold text-brand"
          : "text-ink/70 hover:bg-black/[.04] hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * The phone drawer.
 *
 * A native <dialog>, like every other modal in the app: focus trapping, Esc,
 * the backdrop and the inertness of everything behind it come from the platform
 * instead of being reimplemented once per component. It is opened by state
 * rather than an imperative ref, so what is on screen cannot drift out of step
 * with what the component thinks is open.
 *
 * The body is locked while it is open. A modal <dialog> already blocks pointer
 * interaction underneath, but on a phone the page behind a left drawer will
 * still take a scroll gesture, which reads as the drawer failing to catch the
 * touch — so the lock is explicit rather than left to the browser.
 */
function AdminDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // showModal() on an already-open dialog throws, so both sides are guarded.
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      id="admin-drawer"
      ref={ref}
      aria-label="เมนูแอดมิน"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // The backdrop reports its clicks as the dialog itself; anything inside
      // hits the panel below and is left alone.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="drawer-left m-0 h-dvh max-h-dvh w-[17rem] max-w-[85vw] bg-white p-0 text-ink backdrop:bg-black/50 sm:hidden"
    >
      <div className="flex h-full flex-col gap-5 overflow-y-auto px-4 py-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/45">
            เมนูแอดมิน
          </span>
          <button type="button" onClick={onClose} className={btnGhost}>
            <CloseIcon />
            ปิด
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M3 5h14M3 10h14M3 15h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="m5 5 10 10M15 5 5 15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
