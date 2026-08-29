"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";

import {
  banUserAction,
  closeItemAction,
  deleteItemAction,
  dismissReportsAction,
  type AdminActionState,
} from "@/app/admin/reports/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { REPORT_REASON_LABEL, type ReportReason } from "@/lib/moderation-labels";
import { btnDangerSm, btnPrimarySm, btnSecondarySm } from "@/lib/button";
import { formatBaht } from "@/lib/money";

const initialState: AdminActionState = { ok: false, message: null };

export type ReportedRow = {
  itemId: string;
  title: string;
  price: number;
  status: string;
  paymentState: string;
  deleted: boolean;
  seller: { id: string; name: string; email: string };
  reportCount: number;
  reports: {
    id: string;
    reason: ReportReason;
    note: string | null;
    reporterName: string;
    when: string;
  }[];
};

/**
 * One reported listing, and everything an admin can do about it.
 *
 * The order of the controls is the order of the decision: read what was
 * reported, look at the listing, then either reject the reports or take it
 * down — and separately, deal with the seller.
 */
export function AdminReportRow({ row }: { row: ReportedRow }) {
  const [deleteState, remove, removing] = useActionState(deleteItemAction, initialState);
  const [closeState, close, closing] = useActionState(closeItemAction, initialState);
  const [dismissState, dismiss, dismissing] = useActionState(dismissReportsAction, initialState);
  const [banState, ban, banning] = useActionState(banUserAction, initialState);

  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [banOpen, setBanOpen] = useState(false);
  const deleteForm = useRef<HTMLFormElement>(null);

  // Removal is refused while a winner still owes money; saying so up front
  // beats offering a button that returns an explanation.
  const owesPayment = row.paymentState === "awaiting_payment";
  const message =
    deleteState.message ?? closeState.message ?? dismissState.message ?? banState.message;
  const messageOk =
    deleteState.ok || closeState.ok || dismissState.ok || banState.ok;

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-white p-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href={`/auctions/${row.itemId}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.title}
        </Link>
        <span className="rounded bg-brand/12 px-2 py-0.5 text-xs font-medium text-brand">
          ถูกแจ้ง {row.reportCount} ครั้ง
        </span>
      </div>

      <p className="text-xs text-ink/60">
        {formatBaht(row.price)} · ผู้ขาย {row.seller.name} ({row.seller.email})
        {row.deleted ? " · ลบแล้ว" : ""}
      </p>

      <ul className="flex flex-col gap-1.5 border-t border-black/5 pt-2">
        {row.reports.map((report) => (
          <li key={report.id} className="text-xs">
            <span className="font-medium">{REPORT_REASON_LABEL[report.reason]}</span>
            <span className="text-ink/55"> · {report.reporterName} · {report.when}</span>
            {report.note ? (
              <p className="mt-0.5 whitespace-pre-wrap text-ink/70">{report.note}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {owesPayment ? (
        <p className="text-xs text-warning">
          มีผู้ชนะรอชำระเงิน — ปิดการประมูลก่อนจึงจะลบได้
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-black/5 pt-3">
        {!row.deleted ? (
          <>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="เหตุผลที่ลบ"
              aria-label="เหตุผลที่ลบ"
              className="min-w-0 flex-1 rounded-lg border border-black/15 px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={removing || owesPayment || reason.trim() === ""}
              onClick={() => setConfirming(true)}
              className={btnDangerSm}
            >
              {removing ? "กำลังลบ…" : "ลบสินค้า"}
            </button>

            <form ref={deleteForm} action={remove} className="hidden">
              <input type="hidden" name="itemId" value={row.itemId} />
              <input type="hidden" name="reason" value={reason} />
            </form>

            <ConfirmDialog
              open={confirming}
              title="ลบสินค้านี้?"
              detail="สินค้าจะหายจากหน้าเว็บทันที ประวัติการประมูลยังเก็บไว้"
              confirmLabel="ลบสินค้า"
              pending={removing}
              onCancel={() => setConfirming(false)}
              onConfirm={() => {
                setConfirming(false);
                deleteForm.current?.requestSubmit();
              }}
            />
          </>
        ) : null}

        {row.status === "active" ? (
          <form action={close}>
            <input type="hidden" name="itemId" value={row.itemId} />
            <button type="submit" disabled={closing} className={btnSecondarySm}>
              {closing ? "กำลังปิด…" : "ปิดการประมูล"}
            </button>
          </form>
        ) : null}

        <form action={dismiss}>
          <input type="hidden" name="itemId" value={row.itemId} />
          <button type="submit" disabled={dismissing} className={btnSecondarySm}>
            {dismissing ? "กำลังปิดเรื่อง…" : "ไม่ผิดกฎ ปิดเรื่อง"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setBanOpen((open) => !open)}
          className={btnSecondarySm}
        >
          จัดการผู้ขาย
        </button>
      </div>

      {banOpen ? (
        <form action={ban} className="flex flex-col gap-2 rounded-lg border border-black/10 p-3">
          <input type="hidden" name="userId" value={row.seller.id} />
          <p className="text-xs text-ink/60">แบน {row.seller.email}</p>

          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <input type="radio" name="kind" value="bidding" defaultChecked className="accent-brand" />
              ห้ามเสนอราคา
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="radio" name="kind" value="login" className="accent-brand" />
              ห้ามเข้าสู่ระบบ
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {[1, 3, 7, 30].map((days, index) => (
              <label key={days} className="flex items-center gap-1.5 text-xs">
                <input
                  type="radio"
                  name="duration"
                  value={String(days)}
                  defaultChecked={index === 0}
                  className="accent-brand"
                />
                {days} วัน
              </label>
            ))}
            <label className="flex items-center gap-1.5 text-xs">
              <input type="radio" name="duration" value="permanent" className="accent-brand" />
              ถาวร
            </label>
          </div>

          <input
            name="reason"
            required
            placeholder="เหตุผล"
            aria-label="เหตุผลที่แบน"
            className="rounded-lg border border-black/15 px-3 py-1.5 text-sm"
          />
          <button type="submit" disabled={banning} className={`${btnPrimarySm} self-start`}>
            {banning ? "กำลังแบน…" : "แบนบัญชีนี้"}
          </button>
        </form>
      ) : null}

      {message ? (
        <p className={messageOk ? "text-xs text-success" : "text-xs text-brand"}>
          {message}
        </p>
      ) : null}
    </li>
  );
}
