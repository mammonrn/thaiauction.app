import Link from "next/link";

import { IdentityForm } from "@/components/identity-form";
import { KycSubmitForm, KycWithdrawButton } from "@/components/kyc-submit-form";
import { canEditIdentity } from "@/app/account/verification/actions";
import {
  MIN_SELLER_AGE,
  ageOn,
  dateOfBirthInputValue,
} from "@/lib/identity";
import { needsIdentityResubmission } from "@/lib/seller-verification";
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
  // An approval granted before this data existed. See lib/seller-verification.
  const mustResubmit = await needsIdentityResubmission(user.id);
  // A re-submission in progress: approved standing plus a live pending request.
  const resubmitPending = mustResubmit && status === "pending";
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
    <main className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link
          href="/account"
          className="text-sm text-ink/60 underline-offset-4 hover:underline sm:hidden"
        >
          ← กลับหน้าบัญชีของฉัน
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">ยืนยันตัวตนผู้ขาย</h1>
      </div>

      {status === "approved" ? (
        <section className="flex flex-col gap-2 rounded-xl border border-success/35 bg-success/12 px-5 py-4">
          <p className="font-medium text-success">
            ยืนยันตัวตนแล้ว
          </p>
          {/* The retention rule is in /privacy. Restating it here made the
              reader parse a sentence to find the date. */}
          <p className="text-sm text-success/80">
            อนุมัติเมื่อ{" "}
            {latest?.reviewedAt ? formatThaiDateTime(latest.reviewedAt) : "-"}
          </p>
        </section>
      ) : null}

      {/* The legacy case: approved, but the reviewer never recorded a name or
          date of birth because the marketplace did not ask for them yet. The
          card was erased on approval, so there is nothing to check against
          after the fact — submitting again is the only way to close the gap. */}
      {mustResubmit && !resubmitPending ? (
        <section className="flex flex-col gap-2 rounded-xl border border-warning/35 bg-warning/12 px-5 py-4">
          <p className="font-medium text-warning">
            ต้องยืนยันตัวตนอีกครั้ง
          </p>
          <p className="text-sm text-warning/80">
            กรอกข้อมูลและส่งรูปบัตรใหม่อีกครั้ง · สถานะผู้ขายเดิมยังใช้งานได้
          </p>
        </section>
      ) : null}

      {resubmitPending ? (
        <section className="flex flex-col gap-2 rounded-xl border border-success/35 bg-success/12 px-5 py-4">
          <p className="font-medium text-success">
            ส่งคำขอใหม่แล้ว — สถานะผู้ขายเดิมยังใช้งานได้
          </p>
          <p className="text-sm text-success/80">
            ลงขายและรับเงินได้ตามปกติระหว่างรอตรวจสอบ
          </p>
        </section>
      ) : null}

      {status === "pending" ? (
        <section className="flex flex-col gap-3 rounded-xl border border-warning/35 bg-warning/12 px-5 py-4">
          <p className="font-medium text-warning">
            รอตรวจสอบ
          </p>
          <p className="text-sm text-warning/80">
            ส่งเมื่อ{" "}
            {latest ? formatThaiDateTime(latest.submittedAt) : "-"} ·
            ใช้เวลาตรวจสอบประมาณ 2-3 ชั่วโมง
          </p>
          <KycWithdrawButton />
        </section>
      ) : null}

      {status === "rejected" ? (
        <section className="flex flex-col gap-2 rounded-xl border border-brand/40 bg-brand/[.06] px-5 py-4">
          <p className="font-medium text-brand-dark">
            คำขอถูกปฏิเสธ
          </p>
          {latest?.rejectionReason ? (
            <p className="text-sm text-brand-dark/80">
              เหตุผล: {latest.rejectionReason}
            </p>
          ) : null}
          <p className="text-sm text-brand-dark/80">
            แก้ไขตามเหตุผลข้างต้นแล้วส่งใหม่ได้เลย
          </p>
        </section>
      ) : null}

      {/* Step 1. Identity is asked for before the document, so the reviewer
          always has something to compare the card against — and so an underage
          seller is told before uploading a photo of their ID for nothing. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          ขั้นที่ 1 — ข้อมูลตามบัตรประชาชน
        </h2>

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
          <div className="flex flex-col gap-2 rounded-xl border border-black/10 px-5 py-4">
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink/60">ชื่อ-นามสกุล</dt>
                <dd className="font-medium">
                  {identity.firstName} {identity.lastName}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/60">วันเกิด</dt>
                <dd className="font-medium">
                  {identity.dateOfBirth ? formatThaiDate(identity.dateOfBirth) : "-"}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-ink/50">
              {status === "approved"
                ? "แก้ไขไม่ได้ · ติดต่อทีมงานหากไม่ถูกต้อง"
                : "แก้ไขไม่ได้ระหว่างรอตรวจสอบ"}
            </p>
          </div>
        )}
      </section>

      {/* Step 2. Only offered once step 1 is done and the seller is eligible. */}
      {(status !== "approved" && status !== "pending") ||
      (mustResubmit && status !== "pending") ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">ขั้นที่ 2 — อัปโหลดรูปบัตรประชาชน</h2>

          {!identityComplete ? (
            <p className="rounded-xl border border-dashed border-black/20 px-5 py-4 text-sm text-ink/60">
              กรอกข้อมูลในขั้นที่ 1 ให้ครบก่อน แล้วช่องอัปโหลดจะปรากฏขึ้น
            </p>
          ) : !oldEnough ? (
            <p className="rounded-xl border border-warning/35 bg-warning/12 px-5 py-4 text-sm text-warning">
              ผู้ขายต้องมีอายุ {MIN_SELLER_AGE} ปีขึ้นไป
            </p>
          ) : (
            <>
              {/* Two instructions, both of which change what the seller does
                  in the next thirty seconds. Covering the religion field is an
                  action and stays; WHY it matters, and how long the image is
                  kept, are policy and live in /privacy. */}
              <ul className="flex list-disc flex-col gap-1 rounded-xl border border-black/10 px-5 py-4 pl-9 text-sm text-ink/70">
                <li>ถ่ายให้เห็นตัวอักษรชัดเจน ไม่เบลอ ไม่มีแสงสะท้อน</li>
                <li>
                  ปิดทับช่อง <strong>ศาสนา</strong> ก่อนถ่าย
                </li>
              </ul>

              <KycSubmitForm
                submitLabel={
                  mustResubmit
                    ? "ยืนยันตัวตนอีกครั้ง"
                    : status === "rejected"
                      ? "ส่งคำขอใหม่"
                      : "ส่งคำขอยืนยันตัวตน"
                }
              />
            </>
          )}
        </section>
      ) : null}

    </main>
  );
}
