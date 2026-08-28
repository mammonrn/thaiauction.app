"use client";

import Script from "next/script";
import { useActionState, useEffect, useState } from "react";

import {
  payWithCardAction,
  payWithPromptPayAction,
  type PayActionState,
} from "@/app/auctions/[id]/pay/actions";
import { formatBaht } from "@/lib/money";
import { btnPrimary } from "@/lib/button";

/**
 * Card details are typed into THIS component and never leave the browser
 * except to Omise. `Omise.createToken` posts them straight to vault.omise.co
 * with the PUBLIC key; what reaches our Server Action is a `tokn_...` handle.
 *
 * The inputs deliberately have no `name` attribute. Without one they are not
 * serialised into the FormData a Server Action receives, so even a mistake in
 * the submit handler cannot send a card number to our server.
 */
declare global {
  interface Window {
    OmiseCard?: unknown;
    Omise?: {
      setPublicKey: (key: string) => void;
      createToken: (
        type: "card",
        data: Record<string, string>,
        callback: (
          statusCode: number,
          response: { id?: string; message?: string },
        ) => void,
      ) => void;
    };
  }
}

type PaymentSnapshot = {
  id: string;
  status: "pending" | "successful" | "failed" | "expired";
  method: "card" | "promptpay";
  qrDownloadUri: string | null;
  expiresAt: string | null;
  failureMessage: string | null;
};

const EMPTY: PayActionState = { ok: false, message: null };

export function PaymentPanel({
  itemId,
  amount,
  publicKey,
  windowHours,
  initialPayment,
}: {
  itemId: string;
  amount: number;
  publicKey: string;
  windowHours: number;
  initialPayment: PaymentSnapshot | null;
}) {
  const [method, setMethod] = useState<"card" | "promptpay">(
    initialPayment?.method ?? "promptpay",
  );
  const [payment, setPayment] = useState<PaymentSnapshot | null>(
    initialPayment,
  );
  const [tokenising, setTokenising] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  const [cardState, cardAction, cardPending] = useActionState(
    payWithCardAction,
    EMPTY,
  );
  const [qrState, qrAction, qrPending] = useActionState(
    payWithPromptPayAction,
    EMPTY,
  );

  // A Server Action that started an attempt hands back its id; adopt it so the
  // poll below picks it up. Adjusted during render rather than in an effect —
  // React's own "changing state when props change" pattern. It is tracked in
  // state, not a ref: a ref cannot be read or written during render.
  const [adopted, setAdopted] = useState<string | null>(
    initialPayment?.id ?? null,
  );
  const started = cardState.paymentId ?? qrState.paymentId ?? null;
  if (started && started !== adopted) {
    setAdopted(started);
    setPayment({
      id: started,
      status: "pending",
      method,
      qrDownloadUri: null,
      expiresAt: null,
      failureMessage: null,
    });
  }

  const paymentId = payment?.id ?? null;
  const settled =
    payment?.status === "successful" ||
    payment?.status === "failed" ||
    payment?.status === "expired";

  // Poll while an attempt is live. Every poll makes the server re-ask Omise,
  // so this is what turns a scanned QR into a settled auction — the same
  // approach the live auction page uses, for the same reason: one small VPS,
  // where a few seconds of delay costs nothing and sockets cost plenty.
  useEffect(() => {
    if (!paymentId || settled) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch(`/api/payments/${paymentId}/state`, {
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const data = await response.json();
        setPayment((current) =>
          current && current.id === paymentId
            ? {
                ...current,
                status: data.status,
                qrDownloadUri: data.qrDownloadUri,
                expiresAt: data.expiresAt,
                failureMessage: data.failureMessage,
              }
            : current,
        );
      } catch {
        // A dropped poll is not worth surfacing; the next one retries.
      }
    };

    void tick();
    const timer = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [paymentId, settled]);

  if (payment?.status === "successful") {
    return (
      <section className="flex flex-col gap-2 rounded-xl border border-green-600/30 bg-green-50 p-5 text-sm">
        <h2 className="font-semibold text-green-800">
          ชำระเงินสำเร็จ
        </h2>
        <p className="text-green-900/80">
          ขอบคุณครับ ทีมงานจะโอนเงินให้ผู้ขายและแจ้งให้จัดส่งสินค้าต่อไป
        </p>
      </section>
    );
  }

  async function handleCardSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCardError(null);

    const omise = window.Omise;
    if (!omise) {
      setCardError("ยังโหลดระบบชำระเงินไม่เสร็จ กรุณารอสักครู่แล้วลองใหม่");
      return;
    }

    const form = event.currentTarget;
    const read = (id: string) =>
      (form.querySelector(`#${id}`) as HTMLInputElement | null)?.value ?? "";

    setTokenising(true);
    omise.setPublicKey(publicKey);
    omise.createToken(
      "card",
      {
        name: read("card-name"),
        number: read("card-number").replace(/\s/g, ""),
        expiration_month: read("card-exp-month"),
        expiration_year: read("card-exp-year"),
        security_code: read("card-cvc"),
      },
      (statusCode, response) => {
        setTokenising(false);

        if (statusCode !== 200 || !response.id) {
          setCardError(response.message ?? "ข้อมูลบัตรไม่ถูกต้อง");
          return;
        }

        // Only the token travels onward. The fields above are never read again.
        const data = new FormData();
        data.set("itemId", itemId);
        data.set("token", response.id);
        cardAction(data);
      },
    );
  }

  const busy = tokenising || cardPending || qrPending;
  const qrLive = payment?.status === "pending" && payment.qrDownloadUri;

  return (
    <section className="flex flex-col gap-5">
      <Script src="https://cdn.omise.co/omise.js" strategy="afterInteractive" />

      <div className="flex gap-2" role="tablist">
        {(["promptpay", "card"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={method === option}
            onClick={() => setMethod(option)}
            disabled={payment?.status === "pending"}
            className={`rounded-lg border px-4 py-2 text-sm disabled:opacity-50 ${
              method === option
                ? "border-brand bg-brand text-white"
                : "border-black/15"
            }`}
          >
            {option === "promptpay" ? "PromptPay QR" : "บัตรเครดิต/เดบิต"}
          </button>
        ))}
      </div>

      {payment?.status === "pending" && !qrLive && method === "promptpay" ? (
        <p className="text-sm text-ink/60">
          กำลังสร้าง QR…
        </p>
      ) : null}

      {qrLive ? (
        <div className="flex flex-col items-center gap-3 rounded-xl bg-white p-5">
          <p className="text-sm">
            สแกน QR นี้ด้วยแอปธนาคารเพื่อชำระ {formatBaht(amount)}
          </p>
          {/* Omise serves a full PromptPay payment slip, not a bare QR square:
              a 740x1050 portrait SVG carrying the logo, the amount and the
              code. Forcing it into a square would stretch it by ~40% and a
              distorted QR does not scan, so the width is fixed and the height
              follows the intrinsic ratio.

              The src is Omise's stable api.omise.co document URL, which 302s to
              a presigned S3 link valid for only 60 seconds. Storing that
              redirect target instead would give us a URL that dies a minute
              later; this one re-signs on every load. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={payment.qrDownloadUri ?? ""}
            alt="PromptPay QR สำหรับชำระเงิน"
            className="h-auto w-full max-w-[320px]"
          />
          <p className="text-center text-xs text-ink/50">
            หน้านี้จะอัปเดตเองเมื่อชำระเงินสำเร็จ ไม่ต้องรีเฟรช
            {payment.expiresAt
              ? " — QR นี้มีอายุจำกัด หากหมดอายุให้กดสร้างใหม่"
              : ""}
          </p>
        </div>
      ) : null}

      {payment?.status === "failed" || payment?.status === "expired" ? (
        <p className="rounded-lg border border-brand/40 bg-brand/[.05] px-4 py-3 text-sm text-brand-dark">
          {payment.status === "expired"
            ? "QR หมดอายุแล้ว กรุณาสร้างใหม่"
            : (payment.failureMessage ?? "ชำระเงินไม่สำเร็จ กรุณาลองใหม่")}
        </p>
      ) : null}

      {!qrLive && payment?.status !== "pending" ? (
        method === "promptpay" ? (
          <form action={qrAction} className="flex flex-col gap-3">
            <input type="hidden" name="itemId" value={itemId} />
            <button
              type="submit"
              disabled={busy}
              className={btnPrimary}
            >
              {qrPending ? "กำลังสร้าง QR…" : `สร้าง QR — ${formatBaht(amount)}`}
            </button>
            {qrState.message ? (
              <p className="text-sm text-brand">
                {qrState.message}
              </p>
            ) : null}
          </form>
        ) : (
          <form onSubmit={handleCardSubmit} className="flex flex-col gap-3">
            <Field id="card-name" label="ชื่อบนบัตร" autoComplete="cc-name" />
            <Field
              id="card-number"
              label="หมายเลขบัตร"
              inputMode="numeric"
              autoComplete="cc-number"
            />
            <div className="grid grid-cols-3 gap-3">
              <Field
                id="card-exp-month"
                label="เดือน"
                placeholder="MM"
                inputMode="numeric"
                autoComplete="cc-exp-month"
              />
              <Field
                id="card-exp-year"
                label="ปี (ค.ศ.)"
                placeholder="YYYY"
                inputMode="numeric"
                autoComplete="cc-exp-year"
              />
              <Field
                id="card-cvc"
                label="CVC"
                inputMode="numeric"
                autoComplete="cc-csc"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className={btnPrimary}
            >
              {busy ? "กำลังดำเนินการ…" : `ชำระ ${formatBaht(amount)}`}
            </button>
            {cardError ? (
              <p className="text-sm text-brand">
                {cardError}
              </p>
            ) : null}
            {cardState.message ? (
              <p className="text-sm text-brand">
                {cardState.message}
              </p>
            ) : null}
            <p className="text-xs text-ink/50">
              ข้อมูลบัตรถูกส่งตรงไปยัง Omise ผ่านการเข้ารหัสในเบราว์เซอร์
              ระบบของเราไม่เก็บและไม่เห็นหมายเลขบัตรของคุณ
            </p>
          </form>
        )
      ) : null}

      <p className="text-xs text-ink/50">
        หากไม่ชำระภายใน {windowHours} ชั่วโมงหลังปิดประมูล
        สิทธิ์การซื้อจะถูกส่งต่อให้ผู้เสนอราคารายถัดไป
        และระบบจะบันทึกการไม่ชำระเงินไว้ในบัญชีของคุณ
      </p>
    </section>
  );
}

/**
 * A card field. No `name`, on purpose — see the note at the top of the file:
 * without one the value cannot be serialised into a Server Action's FormData.
 */
function Field({
  id,
  label,
  ...rest
}: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-ink/70">{label}</span>
      <input
        id={id}
        required
        className="rounded-lg border border-black/15 px-3 py-2"
        {...rest}
      />
    </label>
  );
}
