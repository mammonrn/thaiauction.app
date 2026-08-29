
import { AdminBackLink } from "@/components/admin-back-link";

import { VerificationReview } from "@/components/verification-review";
import { requireAdmin } from "@/lib/admin";
import { ageOn } from "@/lib/identity";
import { prisma } from "@/lib/prisma";
import { formatThaiDate, formatThaiDateTime } from "@/lib/thai-datetime";

export default async function AdminVerificationsPage({
  searchParams,
}: PageProps<"/admin/verifications">) {
  // 404s for anyone who is not an administrator.
  await requireAdmin("/admin/verifications");

  const { decided } = await searchParams;

  const [pending, recent] = await Promise.all([
    prisma.sellerVerification.findMany({
      where: { status: "pending" },
      orderBy: { submittedAt: "asc" },
      select: {
        id: true,
        submittedAt: true,
        documentKey: true,
        user: {
          select: {
            name: true,
            email: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
          },
        },
      },
    }),
    // The audit trail: what was decided, by whom, when.
    prisma.sellerVerification.findMany({
      where: { status: { in: ["approved", "rejected"] } },
      orderBy: { reviewedAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        reviewedAt: true,
        rejectionReason: true,
        documentDeletedAt: true,
        user: { select: { name: true, email: true } },
        reviewedBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-2">
        <AdminBackLink />
        <h1 className="text-2xl font-semibold tracking-tight">
          ตรวจสอบการยืนยันตัวตน
        </h1>
        <p className="text-sm text-ink/60">
          เทียบชื่อ-นามสกุลและวันเกิดกับที่ปรากฏบนบัตร
        </p>
      </div>

      {decided === "approved" || decided === "rejected" ? (
        <p
          role="status"
          className="rounded-xl border border-success/35 bg-success/12 px-5 py-4 text-sm text-success"
        >
          บันทึกผลเรียบร้อย — {decided === "approved" ? "อนุมัติ" : "ปฏิเสธ"}
          คำขอแล้ว และลบรูปบัตรออกจากระบบเรียบร้อย
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">รอตรวจสอบ ({pending.length})</h2>

        {pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/20 px-5 py-8 text-center text-sm text-ink/60">
            ไม่มีคำขอที่รอตรวจสอบ
          </p>
        ) : (
          <ul className="flex flex-col gap-6">
            {pending.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-4 rounded-xl bg-white p-5"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-ink/60">
                    บัญชี: {row.user.name} · {row.user.email}
                  </span>
                  <span className="text-xs text-ink/50">
                    ส่งเมื่อ {formatThaiDateTime(row.submittedAt)}
                  </span>
                </div>

                {/* The reference data, stated before the image so the reviewer
                    reads what to expect and then checks the card against it,
                    rather than reading the card and rationalising a match. */}
                <dl className="flex flex-col gap-1 rounded-lg border border-black/10 bg-black/[.02] p-4 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-ink/60">
                      ชื่อ-นามสกุลที่แจ้ง
                    </dt>
                    <dd className="text-base font-semibold">
                      {row.user.firstName} {row.user.lastName}
                    </dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-ink/60">
                      วันเกิดที่แจ้ง
                    </dt>
                    <dd className="text-base font-semibold">
                      {row.user.dateOfBirth
                        ? `${formatThaiDate(row.user.dateOfBirth)} (อายุ ${ageOn(row.user.dateOfBirth, new Date())} ปี)`
                        : "-"}
                    </dd>
                  </div>
                </dl>

                {row.documentKey ? (
                  <VerificationReview
                    verificationId={row.id}
                    documentUrl={`/api/kyc/${row.documentKey}`}
                  />
                ) : (
                  <p className="text-sm text-brand">
                    ไม่พบไฟล์เอกสาร
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">ประวัติการตรวจสอบล่าสุด</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-ink/60">ยังไม่มีประวัติ</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 text-sm">
            {recent.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.user.email}</span>
                  <span
                    className={
                      row.status === "approved"
                        ? "rounded-full bg-success/12 px-2 py-0.5 text-xs text-success"
                        : "rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-dark"
                    }
                  >
                    {row.status === "approved" ? "อนุมัติ" : "ปฏิเสธ"}
                  </span>
                </span>
                <span className="text-xs text-ink/60">
                  โดย {row.reviewedBy?.email ?? "-"} ·{" "}
                  {row.reviewedAt ? formatThaiDateTime(row.reviewedAt) : "-"}
                  {row.documentDeletedAt ? " · ลบรูปแล้ว" : ""}
                </span>
                {row.rejectionReason ? (
                  <span className="text-xs text-ink/60">
                    เหตุผล: {row.rejectionReason}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
