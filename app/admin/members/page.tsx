import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/admin";
import { btnPrimarySm } from "@/lib/button";
import { BAN_KIND_LABEL } from "@/lib/bans";
import {
  KYC_LABEL,
  listMembers,
  parseRoleFilter,
  ROLE_FILTER_LABEL,
  ROLE_LABEL,
  type MemberRow,
  type RoleFilter,
} from "@/lib/members";
import { formatThaiDate, formatThaiDateTime } from "@/lib/thai-datetime";

export const metadata = { title: "สมาชิกทั้งหมด" };

/**
 * Everyone with an account.
 *
 * A LIST OF CARDS, not a `<table>`, following /admin/bans and /admin/reports
 * rather than inventing a third shape for an admin list. Seven columns of
 * table on a 390px screen is either a horizontal scrollbar or four-point type;
 * a card per person reads down the phone and lines its labels up into columns
 * from `sm:` upwards, where there is room for them.
 *
 * It shows STATE only. Nothing here is an ID document, a bank account or an
 * address — a page for finding people should not also be a page that leaks
 * them. Everything that needs the real detail links to the tool that already
 * owns it, which is also why this page has no actions of its own: banning
 * belongs with the ban history, reviewing an ID with the review queue.
 */
export default async function AdminMembersPage({
  searchParams,
}: PageProps<"/admin/members">) {
  await requireAdmin("/admin/members");

  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim() : "";
  const role = parseRoleFilter(typeof params.role === "string" ? params.role : undefined);
  const page = Math.max(1, Number(params.page) || 1);

  const { rows, total, pageCount } = await listMembers({ search, role, page });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <AdminBackLink />
        <h1 className="text-2xl font-semibold tracking-tight">สมาชิกทั้งหมด</h1>
        <p className="text-sm text-ink/60">
          {total.toLocaleString("th-TH")} คน
          {search || role !== "all" ? " (ตามที่กรอง)" : ""}
        </p>
      </header>

      {/* A plain GET form and plain links, like the listing controls: both work
          before any JavaScript has loaded, and every view is a shareable URL an
          admin can send to another admin. */}
      <form action="/admin/members" className="flex flex-wrap gap-2">
        <input type="hidden" name="role" value={role} />
        <label htmlFor="member-search" className="sr-only">
          ค้นหาสมาชิก
        </label>
        <input
          id="member-search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="ชื่อ อีเมล หรือเบอร์โทร"
          className="min-w-0 flex-1 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
        />
        <button type="submit" className={`${btnPrimarySm} shrink-0`}>
          ค้นหา
        </button>
      </form>

      <div className="rail -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {(Object.keys(ROLE_FILTER_LABEL) as RoleFilter[]).map((key) => (
          <Chip
            key={key}
            href={hrefFor({ q: search, role: key })}
            active={role === key}
            label={ROLE_FILTER_LABEL[key]}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink/60">
          {search ? `ไม่พบสมาชิกที่ตรงกับ “${search}”` : "ยังไม่มีสมาชิก"}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <MemberCard key={row.id} row={row} />
          ))}
        </ul>
      )}

      <Pagination page={page} pageCount={pageCount} search={search} role={role} />
    </main>
  );
}

function hrefFor(params: { q: string; role: RoleFilter; page?: number }): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.role !== "all") search.set("role", params.role);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const qs = search.toString();
  return qs ? `/admin/members?${qs}` : "/admin/members";
}

/**
 * One person.
 *
 * The identity first, then what they are, then anything wrong. A ban is the
 * only thing on the card that ever needs acting on, so it is the only thing in
 * an accent colour — everything else is a fact, and facts are ink.
 */
function MemberCard({ row }: { row: MemberRow }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl bg-white p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium">{row.name}</span>
        <span className="text-xs text-ink/50">
          สมัคร {formatThaiDate(row.createdAt)}
        </span>
      </div>

      <p className="break-all text-xs text-ink/60">{row.email}</p>

      <p className="text-xs text-ink/60">
        {row.phone ? (
          <>
            {row.phone} ·{" "}
            <span className="text-success">ยืนยันเบอร์แล้ว</span>
          </>
        ) : (
          <span className="text-ink/45">ยังไม่ยืนยันเบอร์โทร</span>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {row.role === "none" ? (
          <Badge tone="quiet" label={ROLE_LABEL.none} />
        ) : (
          <>
            {(row.role === "buyer" || row.role === "both") && (
              <Badge tone="quiet" label="ผู้ซื้อ" />
            )}
            {(row.role === "seller" || row.role === "both") && (
              <Badge tone="quiet" label="ผู้ขาย" />
            )}
          </>
        )}

        {row.kyc ? (
          <Badge
            tone={
              row.kyc === "approved"
                ? "success"
                : row.kyc === "rejected"
                  ? "warning"
                  : "quiet"
            }
            label={`ยืนยันตัวตน: ${KYC_LABEL[row.kyc]}`}
          />
        ) : null}
      </div>

      {row.bans.length > 0 ? (
        <p className="text-xs text-brand">
          {row.bans
            .map(
              (ban) =>
                `${BAN_KIND_LABEL[ban.kind]}${
                  ban.expiresAt ? ` ถึง ${formatThaiDateTime(ban.expiresAt)}` : " ถาวร"
                }`,
            )
            .join(" · ")}
        </p>
      ) : null}

      {/* Where the real detail lives. This page deliberately owns none of it. */}
      <div className="flex flex-wrap gap-3 text-xs">
        <Link
          href={`/admin/bans?user=${row.id}`}
          className="text-info underline-offset-4 hover:underline"
        >
          ประวัติการแบน
        </Link>
        {row.kyc ? (
          <Link
            href="/admin/verifications"
            className="text-info underline-offset-4 hover:underline"
          >
            คำขอยืนยันตัวตน
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "quiet" | "success" | "warning";
}) {
  const classes =
    tone === "success"
      ? "bg-success/12 text-success"
      : tone === "warning"
        ? "bg-warning/12 text-warning"
        : "bg-black/[.06] text-ink/70";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

function Chip({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-black/15 bg-white text-ink/70 hover:border-black/30"
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * Previous and next only.
 *
 * The listing grid's numbered pager exists because a shopper jumps around; an
 * admin working a member list reads it in order or searches for a name, so two
 * controls and a position are the whole of what is needed here.
 */
function Pagination({
  page,
  pageCount,
  search,
  role,
}: {
  page: number;
  pageCount: number;
  search: string;
  role: RoleFilter;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="หน้า" className="flex items-center justify-between gap-3 text-sm">
      {page > 1 ? (
        <Link
          href={hrefFor({ q: search, role, page: page - 1 })}
          className="text-info underline-offset-4 hover:underline"
        >
          ← ก่อนหน้า
        </Link>
      ) : (
        <span className="text-ink/30">← ก่อนหน้า</span>
      )}

      <span className="text-xs text-ink/55">
        หน้า {page} จาก {pageCount}
      </span>

      {page < pageCount ? (
        <Link
          href={hrefFor({ q: search, role, page: page + 1 })}
          className="text-info underline-offset-4 hover:underline"
        >
          ถัดไป →
        </Link>
      ) : (
        <span className="text-ink/30">ถัดไป →</span>
      )}
    </nav>
  );
}
