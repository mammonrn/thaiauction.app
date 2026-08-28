import Link from "next/link";

import { KycSubmitForm, KycWithdrawButton } from "@/components/kyc-submit-form";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { formatThaiDateTime } from "@/lib/thai-datetime";

export default async function VerificationPage() {
  const { user } = await requireSession("/account/verification");

  const latest = await prisma.sellerVerification.findFirst({
    where: { userId: user.id },
    orderBy: { submittedAt: "desc" },
    select: {
      status: true,
      submittedAt: true,
      reviewedAt: true,
      rejectionReason: true,
    },
  });

  const status = latest?.status ?? null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <Link
          href="/account"
          className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
        >
          ← กลับหน้าบัญชีของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">ยืนยันตัวตนผู้ขาย</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          ผู้ขายที่ยืนยันตัวตนแล้วจะมีเครื่องหมายรับรองบนหน้าสินค้า
          ช่วยให้ผู้ซื้อมั่นใจมากขึ้น
        </p>
      </div>

      {status === "approved" ? (
        <section className="flex flex-col gap-2 rounded-xl border border-green-600/40 bg-green-600/10 px-5 py-4">
          <p className="font-medium text-green-800 dark:text-green-300">
            ยืนยันตัวตนแล้ว
          </p>
          <p className="text-sm text-green-800/80 dark:text-green-300/80">
            อนุมัติเมื่อ{" "}
            {latest?.reviewedAt ? formatThaiDateTime(latest.reviewedAt) : "-"} ·
            รูปบัตรถูกลบออกจากระบบแล้ว
          </p>
        </section>
      ) : null}

      {status === "pending" ? (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4">
          <p className="font-medium text-amber-800 dark:text-amber-300">
            รอตรวจสอบ
          </p>
          <p className="text-sm text-amber-800/80 dark:text-amber-300/80">
            ส่งเมื่อ{" "}
            {latest ? formatThaiDateTime(latest.submittedAt) : "-"} ·
            ทีมงานจะตรวจสอบด้วยตนเอง
          </p>
          <KycWithdrawButton />
        </section>
      ) : null}

      {status === "rejected" ? (
        <section className="flex flex-col gap-2 rounded-xl border border-red-600/40 bg-red-600/10 px-5 py-4">
          <p className="font-medium text-red-800 dark:text-red-300">
            คำขอถูกปฏิเสธ
          </p>
          {latest?.rejectionReason ? (
            <p className="text-sm text-red-800/80 dark:text-red-300/80">
              เหตุผล: {latest.rejectionReason}
            </p>
          ) : null}
          <p className="text-sm text-red-800/80 dark:text-red-300/80">
            แก้ไขตามเหตุผลข้างต้นแล้วส่งใหม่ได้เลย
          </p>
        </section>
      ) : null}

      {status !== "approved" && status !== "pending" ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-xl border border-black/10 px-5 py-4 text-sm dark:border-white/15">
            <p className="font-medium">ก่อนอัปโหลด</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-black/70 dark:text-white/70">
              <li>ถ่ายให้เห็นตัวอักษรชัดเจน ไม่เบลอ ไม่มีแสงสะท้อนบัง</li>
              <li>
                แนะนำให้ปิดทับช่อง <strong>ศาสนา</strong>{" "}
                ก่อนถ่าย — เราไม่ต้องใช้ข้อมูลนี้
                และเป็นข้อมูลอ่อนไหวตามกฎหมายคุ้มครองข้อมูลส่วนบุคคล
              </li>
              <li>
                รูปจะถูกเก็บไว้เฉพาะระหว่างรอตรวจสอบ และ
                <strong>ลบทิ้งทันทีที่ทีมงานตัดสิน</strong>
              </li>
              <li>เฉพาะคุณและผู้ตรวจสอบเท่านั้นที่เปิดดูรูปนี้ได้</li>
            </ul>
          </div>

          <KycSubmitForm
            submitLabel={status === "rejected" ? "ส่งคำขอใหม่" : "ส่งคำขอยืนยันตัวตน"}
          />
        </section>
      ) : null}
    </main>
  );
}
