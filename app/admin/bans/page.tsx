import Link from "next/link";

import { AdminBackLink } from "@/components/admin-back-link";
import { AdminBanRow } from "@/components/admin-ban-row";
import { requireAdmin } from "@/lib/admin";
import { BAN_KIND_LABEL } from "@/lib/bans";
import { prisma } from "@/lib/prisma";
import { formatThaiDateTime } from "@/lib/thai-datetime";

export const metadata = { title: "บัญชีที่ถูกแบน" };

/**
 * Every ban ever issued, newest first.
 *
 * The whole history, not only what is in force: an admin deciding whether to
 * ban someone again needs to see that they have been banned twice before, and
 * a ban that expired is exactly the fact that answers "have we dealt with this
 * account already?". Nothing is deleted when a ban ends, so the list is
 * complete by construction.
 */
export default async function AdminBansPage({
  searchParams,
}: PageProps<"/admin/bans">) {
  await requireAdmin("/admin/bans");

  const params = await searchParams;
  // Narrowed to one account when the member list sends an admin here. The
  // whole history is still the default view — this only answers "what has
  // happened to THIS person", which is the question you arrive with when you
  // came from a row about them.
  const userId = typeof params.user === "string" ? params.user : undefined;

  const bans = await prisma.userBan.findMany({
    where: userId ? { userId } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      kind: true,
      reason: true,
      expiresAt: true,
      liftedAt: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
      bannedBy: { select: { name: true, email: true } },
    },
  });

  // react-hooks/purity targets client components, which may re-render at any
  // moment. This is an async Server Component on an admin route: it runs once
  // per request, and whether a ban has expired is exactly the request-time
  // fact it exists to report. Nothing is decided by it — `loginBan` and
  // `biddingBan` evaluate expiry in the query — so this only picks a badge.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const rows = bans.map((ban) => {
    const expired = ban.expiresAt !== null && ban.expiresAt.getTime() <= now;
    return {
      id: ban.id,
      kindLabel: BAN_KIND_LABEL[ban.kind],
      reason: ban.reason,
      userName: ban.user.name,
      userEmail: ban.user.email,
      issuedBy: ban.bannedBy.email,
      issuedAt: formatThaiDateTime(ban.createdAt),
      expiresLabel: ban.expiresAt ? formatThaiDateTime(ban.expiresAt) : "ถาวร",
      // Three states, not two: in force, ended by an admin, ended by time.
      state: ban.liftedAt
        ? ("lifted" as const)
        : expired
          ? ("expired" as const)
          : ("active" as const),
      liftedAt: ban.liftedAt ? formatThaiDateTime(ban.liftedAt) : null,
    };
  });

  const active = rows.filter((row) => row.state === "active").length;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <AdminBackLink />
        <h1 className="text-2xl font-semibold tracking-tight">บัญชีที่ถูกแบน</h1>
        <p className="text-sm text-ink/60">
          กำลังมีผล {active} รายการ · ทั้งหมด {rows.length} รายการ
        </p>
        {userId ? (
          <Link
            href="/admin/bans"
            className="self-start text-sm text-info underline-offset-4 hover:underline"
          >
            ดูทั้งหมด
          </Link>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-ink/60">
          {userId ? "บัญชีนี้ไม่เคยถูกแบน" : "ยังไม่เคยแบนบัญชีใด"}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <AdminBanRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </main>
  );
}
