"use client";

import { useState } from "react";

import { formatBaht } from "@/lib/money";
import { btnPrimary } from "@/lib/button";
import type { InstallmentOffer } from "@/lib/payment-methods";

/**
 * Choose an issuer, then a term.
 *
 * Only terms this amount can actually be split into are shown. Omise enforces
 * the per-month minimum for three of the eight issuers and silently accepts an
 * under-minimum plan for the other five — where the buyer would be refused at
 * the bank's own page, after the redirect, having already spent the auction's
 * one pending attempt. The filtering happens on the server (lib/payment-methods)
 * and this only renders what survived it.
 *
 * The per-month figure is the amount divided by the term and nothing else. It
 * is labelled an estimate because the issuer adds its own interest, which
 * Omise does not tell us in advance and which differs by card.
 */
export function InstallmentPicker({
  offers,
  amount,
  pending,
  onSubmit,
}: {
  offers: InstallmentOffer[];
  amount: number;
  pending: boolean;
  onSubmit: (bank: string, term: number) => void;
}) {
  const [bank, setBank] = useState<string | null>(null);
  const [term, setTerm] = useState<number | null>(null);

  const chosen = offers.find((offer) => offer.bank.code === bank);

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-white p-5">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">ธนาคารผู้ออกบัตร</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {offers.map((offer) => (
            <button
              key={offer.bank.code}
              type="button"
              onClick={() => {
                setBank(offer.bank.code);
                setTerm(null);
              }}
              className={`rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                bank === offer.bank.code
                  ? "border-brand bg-brand/[.06] font-medium text-brand"
                  : "border-black/15 text-ink hover:border-brand/40"
              }`}
            >
              {offer.bank.name}
            </button>
          ))}
        </div>
      </div>

      {chosen ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">จำนวนงวด</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {chosen.terms.map((option) => (
              <button
                key={option.term}
                type="button"
                onClick={() => setTerm(option.term)}
                className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                  term === option.term
                    ? "border-brand bg-brand/[.06] text-brand"
                    : "border-black/15 text-ink hover:border-brand/40"
                }`}
              >
                <span className="text-sm font-medium">{option.term} งวด</span>
                <span className="font-mono text-xs tabular-nums">
                  ~{formatBaht(option.perMonthSatang)}/เดือน
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Two facts, one line each, both of which change what the buyer does
          next. The interest terms belong to the issuer that sets them; that
          instalments cannot be swapped for another method afterwards is a
          consequence of Omise refusing to expire an instalment charge, and the
          buyer has to know it BEFORE choosing, not after. */}
      <p className="text-xs text-ink/55">
        ยอดต่อเดือนเป็นค่าประมาณ ธนาคารผู้ออกบัตรคิดดอกเบี้ยตามเงื่อนไขของธนาคาร
      </p>
      <p className="text-xs text-warning">
        เริ่มผ่อนแล้วเปลี่ยนไปวิธีอื่นไม่ได้จนกว่าธนาคารจะแจ้งผล
      </p>

      <button
        type="button"
        disabled={!bank || !term || pending}
        onClick={() => bank && term && onSubmit(bank, term)}
        className={`${btnPrimary} self-start`}
      >
        {pending ? "กำลังพาไปที่ธนาคาร…" : `ผ่อนชำระ ${formatBaht(amount)}`}
      </button>
    </div>
  );
}
