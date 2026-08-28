"use client";

import Image from "next/image";
import { useActionState, useState } from "react";

import {
  approveVerificationAction,
  rejectVerificationAction,
  type ReviewActionState,
} from "@/app/admin/verifications/actions";

const initialState: ReviewActionState = { ok: false, message: null };

export function VerificationReview({
  verificationId,
  documentUrl,
}: {
  verificationId: string;
  documentUrl: string;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [approveState, approve, approving] = useActionState(
    approveVerificationAction,
    initialState,
  );
  const [rejectState, reject, rejectPending] = useActionState(
    rejectVerificationAction,
    initialState,
  );

  const done = approveState.ok || rejectState.ok;

  if (done) {
    return (
      <p role="status" className="text-sm text-green-700 dark:text-green-400">
        {approveState.message ?? rejectState.message} · รูปบัตรถูกลบแล้ว
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* unoptimized: the optimiser would copy the ID image into Next's own
          on-disk image cache, outside the protected directory and served
          without these access checks. */}
      <a
        href={documentUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="relative block h-64 w-full overflow-hidden rounded-lg border border-black/10 bg-black/5 dark:border-white/15 dark:bg-white/10"
      >
        <Image
          src={documentUrl}
          alt="เอกสารยืนยันตัวตน"
          fill
          sizes="600px"
          className="object-contain"
          unoptimized
        />
      </a>

      <div className="flex flex-wrap items-center gap-3">
        <form action={approve}>
          <input type="hidden" name="verificationId" value={verificationId} />
          <button
            type="submit"
            disabled={approving || rejectPending}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
          >
            {approving ? "กำลังอนุมัติ…" : "อนุมัติ"}
          </button>
        </form>

        {!rejecting ? (
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="rounded-lg border border-red-600/40 px-4 py-2 text-sm text-red-600 transition hover:bg-red-600/10 dark:text-red-400"
          >
            ปฏิเสธ
          </button>
        ) : null}
      </div>

      {rejecting ? (
        <form action={reject} className="flex flex-col gap-2">
          <input type="hidden" name="verificationId" value={verificationId} />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">เหตุผลที่ปฏิเสธ</span>
            <textarea
              name="reason"
              required
              rows={2}
              maxLength={500}
              placeholder="เช่น รูปเบลอ อ่านเลขบัตรไม่ออก"
              className="rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/20 dark:bg-white/5"
            />
            <span className="text-xs text-black/50 dark:text-white/50">
              ผู้ขายจะเห็นข้อความนี้ จึงควรบอกให้ชัดว่าต้องแก้อะไร
            </span>
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={rejectPending}
              className="rounded-lg border border-red-600/40 px-4 py-2 text-sm text-red-600 transition hover:bg-red-600/10 disabled:opacity-60 dark:text-red-400"
            >
              {rejectPending ? "กำลังบันทึก…" : "ยืนยันการปฏิเสธ"}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-lg border border-black/15 px-4 py-2 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              ยกเลิก
            </button>
          </div>
        </form>
      ) : null}

      {approveState.message && !approveState.ok ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {approveState.message}
        </p>
      ) : null}
      {rejectState.message && !rejectState.ok ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {rejectState.message}
        </p>
      ) : null}
    </div>
  );
}
