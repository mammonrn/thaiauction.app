"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";

import {
  withdrawVerificationAction,
  type WithdrawState,
} from "@/app/account/verification/actions";

const initialWithdraw: WithdrawState = { ok: false, message: null };

/** Upload an ID document. Posts to the route handler, not a Server Action. */
export function KycSubmitForm({ submitLabel }: { submitLabel: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("กรุณาเลือกไฟล์");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("document", file);
      const res = await fetch("/api/kyc/submit", { method: "POST", body });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(payload.error ?? "ส่งคำขอไม่สำเร็จ");
      } else {
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    } catch {
      setError("ส่งคำขอไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">รูปบัตรประชาชน (ด้านหน้า)</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-black/15 file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-white/20"
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="self-start rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "กำลังส่ง…" : submitLabel}
      </button>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Cancel a pending request; the image is erased with it. */
export function KycWithdrawButton() {
  const [state, action, pending] = useActionState(
    withdrawVerificationAction,
    initialWithdraw,
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
      >
        {pending ? "กำลังยกเลิก…" : "ยกเลิกคำขอและลบรูป"}
      </button>
      {state.message ? (
        <span
          role="status"
          className={
            state.ok
              ? "text-sm text-green-700 dark:text-green-400"
              : "text-sm text-red-600 dark:text-red-400"
          }
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
