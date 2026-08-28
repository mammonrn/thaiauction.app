import Link from "next/link";

import { VerificationReview } from "@/components/verification-review";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { formatThaiDateTime } from "@/lib/thai-datetime";

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
        user: { select: { name: true, email: true } },
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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-16">
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
        >
          ← กลับหน้าแรก
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          ตรวจสอบการยืนยันตัวตน
        </h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          รูปบัตรจะถูกลบทันทีที่กดอนุมัติหรือปฏิเสธ
        </p>
      </div>

      {decided === "approved" || decided === "rejected" ? (
        <p
          role="status"
          className="rounded-xl border border-green-600/40 bg-green-600/10 px-5 py-4 text-sm text-green-800 dark:text-green-300"
        >
          บันทึกผลเรียบร้อย — {decided === "approved" ? "อนุมัติ" : "ปฏิเสธ"}
          คำขอแล้ว และลบรูปบัตรออกจากระบบเรียบร้อย
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">รอตรวจสอบ ({pending.length})</h2>

        {pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/20 px-5 py-8 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60">
            ไม่มีคำขอที่รอตรวจสอบ
          </p>
        ) : (
          <ul className="flex flex-col gap-6">
            {pending.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-4 rounded-xl border border-black/10 p-5 dark:border-white/15"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{row.user.name}</span>
                  <span className="text-sm text-black/60 dark:text-white/60">
                    {row.user.email}
                  </span>
                  <span className="text-xs text-black/50 dark:text-white/50">
                    ส่งเมื่อ {formatThaiDateTime(row.submittedAt)}
                  </span>
                </div>

                {row.documentKey ? (
                  <VerificationReview
                    verificationId={row.id}
                    documentUrl={`/api/kyc/${row.documentKey}`}
                  />
                ) : (
                  <p className="text-sm text-red-600 dark:text-red-400">
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
          <p className="text-sm text-black/60 dark:text-white/60">ยังไม่มีประวัติ</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 text-sm dark:divide-white/10">
            {recent.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.user.email}</span>
                  <span
                    className={
                      row.status === "approved"
                        ? "rounded-full bg-green-600/10 px-2 py-0.5 text-xs text-green-700 dark:text-green-400"
                        : "rounded-full bg-red-600/10 px-2 py-0.5 text-xs text-red-700 dark:text-red-400"
                    }
                  >
                    {row.status === "approved" ? "อนุมัติ" : "ปฏิเสธ"}
                  </span>
                </span>
                <span className="text-xs text-black/60 dark:text-white/60">
                  โดย {row.reviewedBy?.email ?? "-"} ·{" "}
                  {row.reviewedAt ? formatThaiDateTime(row.reviewedAt) : "-"}
                  {row.documentDeletedAt ? " · ลบรูปแล้ว" : ""}
                </span>
                {row.rejectionReason ? (
                  <span className="text-xs text-black/60 dark:text-white/60">
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
