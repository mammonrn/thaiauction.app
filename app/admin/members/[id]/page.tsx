import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/admin";
import { BAN_KIND_LABEL } from "@/lib/bans";
import {
  AUCTION_STATUS_LABEL,
  BID_OUTCOME_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYOUT_STATUS_LABEL,
  SECTION_LIMIT,
  TRANSFER_STATUS_LABEL,
  memberDetail,
  type Capped,
  type MemberDetail,
} from "@/lib/member-detail";
import { KYC_LABEL, ROLE_LABEL } from "@/lib/members";
import { formatBaht } from "@/lib/money";
import { REFERRAL_STATUS_LABEL } from "@/lib/referral";
import { SHIPPING_LABEL } from "@/lib/shipping";
import { formatThaiDate, formatThaiDateTime } from "@/lib/thai-datetime";

export const metadata = { title: "รายละเอียดสมาชิก" };

/**
 * One member, everything about them, nothing to do to them.
 *
 * The page exists because answering "why was my payment refused" used to mean
 * opening four tools and joining them up by hand. It is READ ONLY on purpose:
 * every action still belongs to the tool that owns it — banning to
 * /admin/bans, identity to /admin/verifications, money to /admin/payouts — and
 * this page links to those rather than growing a second set of controls that
 * would have to be kept in step with the first.
 *
 * Nothing sensitive is on it. No ID photograph, no bank account, no card. The
 * admin who needs one of those opens the tool that exists to show it, which is
 * also the tool that logs having shown it.
 *
 * `requireAdmin` is called here, in the page, exactly as every other admin page
 * calls it. The layout draws the chrome and guards nothing — layouts do not
 * re-render on navigation, so a check up there would be made once and then
 * trusted for the rest of the session.
 */
export default async function AdminMemberDetailPage({
  params,
}: PageProps<"/admin/members/[id]">) {
  const { id } = await params;
  await requireAdmin(`/admin/members/${id}`);

  const member = await memberDetail(id);
  // Same 404 a stranger gets for the whole area: an admin URL that answered
  // "no such member" differently from "not allowed" would be a way of asking
  // whether an id exists.
  if (!member) notFound();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/admin/members"
          className="text-sm text-ink/60 underline-offset-4 hover:underline"
        >
          ← กลับรายชื่อสมาชิก
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{member.name}</h1>
        <p className="break-all text-sm text-ink/60">{member.email}</p>
      </header>

      <Identity member={member} />

      <Section
        title="ประวัติการเสนอราคา"
        capped={member.bids}
        empty="ยังไม่เคยเสนอราคา"
      >
        {member.bids.rows.map((bid) => (
          <Row
            key={bid.id}
            href={`/auctions/${bid.itemId}`}
            title={bid.itemTitle}
            figure={formatBaht(bid.amount)}
            badge={{
              label: BID_OUTCOME_LABEL[bid.outcome],
              tone:
                bid.outcome === "won"
                  ? "success"
                  : bid.outcome === "leading"
                    ? "info"
                    : "quiet",
            }}
            detail={formatThaiDateTime(bid.createdAt)}
          />
        ))}
      </Section>

      <Section
        title="ประวัติการซื้อ"
        capped={member.purchases}
        empty="ยังไม่เคยชนะและชำระเงิน"
      >
        {member.purchases.rows.map((purchase) => (
          <Row
            key={purchase.id}
            href={`/auctions/${purchase.itemId}`}
            title={purchase.itemTitle}
            figure={formatBaht(purchase.amount)}
            badge={{
              label: PAYMENT_STATUS_LABEL[purchase.status],
              tone:
                purchase.status === "successful"
                  ? "success"
                  : purchase.status === "pending"
                    ? "warning"
                    : "quiet",
            }}
            detail={[
              PAYMENT_METHOD_LABEL[purchase.method],
              formatThaiDateTime(purchase.paidAt ?? purchase.createdAt),
              purchase.status === "successful"
                ? SHIPPING_LABEL[purchase.shippingStatus]
                : null,
              purchase.trackingNumber ? `พัสดุ ${purchase.trackingNumber}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        ))}
      </Section>

      <Section title="รายการที่ลงขาย" capped={member.listings} empty="ยังไม่เคยลงขาย">
        {member.listings.rows.map((listing) => (
          <Row
            key={listing.id}
            href={`/auctions/${listing.id}`}
            title={listing.title}
            figure={formatBaht(listing.currentPrice)}
            badge={{
              label: listing.deletedAt
                ? "ถูกลบ"
                : AUCTION_STATUS_LABEL[listing.status],
              tone: listing.deletedAt ? "warning" : "quiet",
            }}
            detail={
              listing.endTime ? `ปิด ${formatThaiDateTime(listing.endTime)}` : "ยังไม่กำหนดเวลาปิด"
            }
          />
        ))}
      </Section>

      <Section
        title="ที่ขายได้"
        capped={member.sales}
        empty="ยังไม่มีรายการที่ขายสำเร็จ"
        footer={
          member.sales.total > 0 ? (
            <Link
              href="/admin/payouts"
              className="text-xs text-info underline-offset-4 hover:underline"
            >
              จัดการการโอนเงินที่หน้ารอโอนให้ผู้ขาย →
            </Link>
          ) : null
        }
      >
        {member.sales.rows.map((sale) => (
          <Row
            key={sale.id}
            href={`/auctions/${sale.itemId}`}
            title={sale.itemTitle}
            figure={formatBaht(sale.sellerNet ?? sale.amount)}
            badge={{
              label: PAYOUT_STATUS_LABEL[sale.payoutStatus],
              tone: sale.payoutStatus === "transferred" ? "success" : "warning",
            }}
            detail={[
              `ยอดขาย ${formatBaht(sale.amount)}`,
              sale.paidAt ? formatThaiDate(sale.paidAt) : null,
              sale.transferStatus ? TRANSFER_STATUS_LABEL[sale.transferStatus] : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        ))}
      </Section>

      <Referrals member={member} />

      <Discipline member={member} />
    </main>
  );
}

/**
 * Who this is.
 *
 * The facts an admin checks first — is the phone verified, did the identity
 * pass, is anything in force against the account — before reading any history.
 */
function Identity({ member }: { member: MemberDetail }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-5 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="quiet" label={ROLE_LABEL[member.role]} />
        {member.kyc ? (
          <Badge
            tone={
              member.kyc === "approved"
                ? "success"
                : member.kyc === "rejected"
                  ? "warning"
                  : "quiet"
            }
            label={`ยืนยันตัวตน: ${KYC_LABEL[member.kyc]}`}
          />
        ) : (
          <Badge tone="quiet" label="ยังไม่ส่งยืนยันตัวตน" />
        )}
        {member.activeBans.map((ban) => (
          <Badge
            key={ban.id}
            tone="brand"
            label={`${BAN_KIND_LABEL[ban.kind]}${
              ban.expiresAt ? ` ถึง ${formatThaiDate(ban.expiresAt)}` : " ถาวร"
            }`}
          />
        ))}
      </div>

      <dl className="flex flex-col gap-1.5">
        <Fact label="สมัครเมื่อ" value={formatThaiDateTime(member.createdAt)} />
        <Fact
          label="เบอร์โทรศัพท์"
          value={
            member.phones.length === 0
              ? "ยังไม่ยืนยัน"
              : member.phones
                  .map((p) => `${p.phone} (ยืนยัน ${formatThaiDate(p.verifiedAt)})`)
                  .join(" · ")
          }
        />
        {member.kycSubmittedAt ? (
          <Fact
            label="ส่งยืนยันตัวตนล่าสุด"
            value={formatThaiDateTime(member.kycSubmittedAt)}
          />
        ) : null}
      </dl>

      {/* The sensitive material is not here and is not going to be. These are
          the tools that own it. */}
      <div className="flex flex-wrap gap-3 border-t border-black/[.06] pt-3 text-xs">
        <Link
          href="/admin/verifications"
          className="text-info underline-offset-4 hover:underline"
        >
          คำขอยืนยันตัวตน (ดูรูปบัตรที่นี่)
        </Link>
        <Link
          href={`/admin/bans?user=${member.id}`}
          className="text-info underline-offset-4 hover:underline"
        >
          จัดการการแบน
        </Link>
      </div>
    </section>
  );
}

/** Who invited them, and who they invited. */
function Referrals({ member }: { member: MemberDetail }) {
  const more = member.invited.total - member.invited.rows.length;

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-medium">การชวนเพื่อน</h2>
        <Link
          href="/admin/referrals"
          className="text-xs text-info underline-offset-4 hover:underline"
        >
          ภาพรวมทั้งระบบ →
        </Link>
      </div>

      <p className="text-ink/70">
        {member.referredBy ? (
          <>
            มาจากลิงก์ของ{" "}
            <Link
              href={`/admin/members/${member.referredBy.id}`}
              className="text-info underline-offset-4 hover:underline"
            >
              {member.referredBy.name}
            </Link>{" "}
            <span className="text-ink/50">
              ({member.referredBy.code} · {formatThaiDate(member.referredBy.signedUpAt)})
            </span>
          </>
        ) : (
          <span className="text-ink/60">ไม่ได้มาจากลิงก์ของใคร</span>
        )}
      </p>

      {member.invited.total === 0 ? (
        <p className="text-ink/60">ยังไม่ได้ชวนใคร</p>
      ) : (
        <>
          <p className="text-ink/70">
            ชวนมาแล้ว {member.invited.total.toLocaleString("th-TH")} คน
          </p>
          <ul className="flex flex-col divide-y divide-black/[.06]">
            {member.invited.rows.map((friend) => (
              <li
                key={friend.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <Link
                  href={`/admin/members/${friend.userId}`}
                  className="text-info underline-offset-4 hover:underline"
                >
                  {friend.name}
                </Link>
                <span className="flex items-center gap-2 text-xs">
                  <Badge
                    tone={friend.status === "verified" ? "success" : "quiet"}
                    label={REFERRAL_STATUS_LABEL[friend.status]}
                  />
                  <span className="text-ink/50">
                    {formatThaiDate(friend.verifiedAt ?? friend.signedUpAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {more > 0 ? (
            <p className="text-xs text-ink/45">และอีก {more} คน</p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Strikes and bans: what the marketplace has held against this account. */
function Discipline({ member }: { member: MemberDetail }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-medium">ประวัติการแบนและการไม่ชำระเงิน</h2>
        <Link
          href={`/admin/bans?user=${member.id}`}
          className="text-xs text-info underline-offset-4 hover:underline"
        >
          หน้าจัดการการแบน →
        </Link>
      </div>

      {member.strikes.total === 0 ? (
        <p className="text-ink/60">ไม่เคยผิดนัดชำระเงิน</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-ink/70">
            ผิดนัดชำระเงิน {member.strikes.total.toLocaleString("th-TH")} ครั้ง
          </p>
          <ul className="flex flex-col divide-y divide-black/[.06]">
            {member.strikes.rows.map((strike) => (
              <li
                key={strike.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <Link
                  href={`/auctions/${strike.itemId}`}
                  className="min-w-0 flex-1 truncate text-info underline-offset-4 hover:underline"
                >
                  {strike.itemTitle}
                </Link>
                <span className="text-xs text-ink/50">
                  {formatBaht(strike.amount)} · {formatThaiDate(strike.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {member.bans.length === 0 ? (
        <p className="text-ink/60">ไม่เคยถูกแบน</p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/[.06]">
          {member.bans.map((ban) => (
            <li key={ban.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
              <span className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={ban.liftedAt ? "quiet" : "brand"}
                  label={BAN_KIND_LABEL[ban.kind]}
                />
                <span className="text-xs text-ink/50">
                  {formatThaiDateTime(ban.createdAt)}
                  {ban.liftedAt ? ` · ยกเลิก ${formatThaiDate(ban.liftedAt)}` : ""}
                  {ban.expiresAt ? ` · หมดอายุ ${formatThaiDate(ban.expiresAt)}` : " · ถาวร"}
                </span>
              </span>
              <span className="text-ink/70">{ban.reason}</span>
              <span className="text-xs text-ink/45">
                โดย {ban.bannedBy?.name ?? "ไม่ทราบ"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A capped list.
 *
 * The heading carries the real total and the list carries the newest twenty,
 * so a busy account reads the same as a quiet one — and "20" never has to be
 * mistaken for "all of them". No pagination: an admin who needs the twenty-first
 * bid is asking a different question, and the tools that answer it already
 * exist.
 */
function Section({
  title,
  capped,
  empty,
  footer,
  children,
}: {
  title: string;
  capped: Capped<unknown>;
  empty: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const more = capped.total - capped.rows.length;

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-medium">{title}</h2>
        <span className="text-xs text-ink/50">
          {capped.total === 0
            ? ""
            : `ทั้งหมด ${capped.total.toLocaleString("th-TH")} รายการ`}
        </span>
      </div>

      {capped.total === 0 ? (
        <p className="text-ink/60">{empty}</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-black/[.06]">{children}</ul>
          {more > 0 ? (
            <p className="text-xs text-ink/45">
              แสดง {SECTION_LIMIT} รายการล่าสุด · อีก {more.toLocaleString("th-TH")} รายการไม่ได้แสดง
            </p>
          ) : null}
          {footer}
        </>
      )}
    </section>
  );
}

/**
 * One line of a history.
 *
 * The title wraps to its own line on a phone and the figure stays with the
 * badge, so a 390px screen reads down rather than sideways.
 */
function Row({
  href,
  title,
  figure,
  badge,
  detail,
}: {
  href: string;
  title: string;
  figure: string;
  badge: { label: string; tone: Tone };
  detail: string;
}) {
  return (
    <li className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Link
          href={href}
          className="min-w-0 flex-1 truncate text-info underline-offset-4 hover:underline"
        >
          {title}
        </Link>
        <span className="font-mono text-xs tabular-nums">{figure}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={badge.tone} label={badge.label} />
        <span className="text-xs text-ink/50">{detail}</span>
      </div>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-ink/50">{label}</dt>
      <dd className="text-ink/80">{value}</dd>
    </div>
  );
}

type Tone = "quiet" | "success" | "warning" | "info" | "brand";

function Badge({ label, tone }: { label: string; tone: Tone }) {
  const classes =
    tone === "success"
      ? "bg-success/12 text-success"
      : tone === "warning"
        ? "bg-warning/12 text-warning"
        : tone === "info"
          ? "bg-info/12 text-info"
          : tone === "brand"
            ? "bg-brand/10 text-brand"
            : "bg-black/[.06] text-ink/70";
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}
