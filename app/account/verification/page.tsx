import Link from "next/link";

import { IdentityForm } from "@/components/identity-form";
import { KycSubmitForm, KycWithdrawButton } from "@/components/kyc-submit-form";
import { canEditIdentity } from "@/app/account/verification/actions";
import {
  MIN_SELLER_AGE,
  ageOn,
  dateOfBirthInputValue,
} from "@/lib/identity";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { formatThaiDate, formatThaiDateTime } from "@/lib/thai-datetime";

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

  // Own row only — this data is never read for anyone but the signed-in user.
  const identity = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { firstName: true, lastName: true, dateOfBirth: true },
  });

  const identityComplete = Boolean(
    identity.firstName && identity.lastName && identity.dateOfBirth,
  );
  const identityEditable = await canEditIdentity(user.id);
  const oldEnough =
    identity.dateOfBirth !== null &&
    ageOn(identity.dateOfBirth, new Date()) >= MIN_SELLER_AGE;

  const today = new Date();
  const maxDateOfBirth = dateOfBirthInputValue(
    new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    ),
  );

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
            ใช้เวลาตรวจสอบประมาณ 2-3 ชั่วโมง
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

      {/* Step 1. Identity is asked for before the document, so the reviewer
          always has something to compare the card against — and so an underage
          seller is told before uploading a photo of their ID for nothing. */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">
            ขั้นที่ 1 — ข้อมูลตามบัตรประชาชน
          </h2>
          <p className="text-sm text-black/60 dark:text-white/60">
            กรอกให้ตรงกับบัตร เจ้าหน้าที่จะใช้เทียบกับรูปที่คุณอัปโหลด
          </p>
        </div>

        {identityEditable ? (
          <IdentityForm
            maxDateOfBirth={maxDateOfBirth}
            initial={{
              firstName: identity.firstName ?? "",
              lastName: identity.lastName ?? "",
              dateOfBirth: identity.dateOfBirth
                ? dateOfBirthInputValue(identity.dateOfBirth)
                : "",
            }}
          />
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-black/10 px-5 py-4 dark:border-white/15">
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-black/60 dark:text-white/60">ชื่อ-นามสกุล</dt>
                <dd className="font-medium">
                  {identity.firstName} {identity.lastName}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-black/60 dark:text-white/60">วันเกิด</dt>
                <dd className="font-medium">
                  {identity.dateOfBirth ? formatThaiDate(identity.dateOfBirth) : "-"}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-black/50 dark:text-white/50">
              {status === "approved"
                ? "ยืนยันแล้วจึงแก้ไขไม่ได้ — หากข้อมูลไม่ถูกต้อง กรุณาติดต่อทีมงาน"
                : "แก้ไขไม่ได้ระหว่างรอตรวจสอบ"}
            </p>
          </div>
        )}
      </section>

      {/* Step 2. Only offered once step 1 is done and the seller is eligible. */}
      {status !== "approved" && status !== "pending" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">ขั้นที่ 2 — อัปโหลดรูปบัตรประชาชน</h2>

          {!identityComplete ? (
            <p className="rounded-xl border border-dashed border-black/20 px-5 py-4 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
              กรอกข้อมูลในขั้นที่ 1 ให้ครบก่อน แล้วช่องอัปโหลดจะปรากฏขึ้น
            </p>
          ) : !oldEnough ? (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-800 dark:text-amber-300">
              ผู้ขายต้องมีอายุ {MIN_SELLER_AGE} ปีบริบูรณ์ขึ้นไปจึงจะยืนยันตัวตนได้
              คุณยังคงซื้อและเสนอราคาได้ตามปกติ
            </p>
          ) : (
            <>
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
                submitLabel={
                  status === "rejected" ? "ส่งคำขอใหม่" : "ส่งคำขอยืนยันตัวตน"
                }
              />
            </>
          )}
        </section>
      ) : null}

    </main>
  );
}
