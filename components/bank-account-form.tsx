"use client";

import { useActionState, useState } from "react";

import {
  saveBankAccountAction,
  sendBankUnlockOtpAction,
  verifyBankUnlockAction,
  type BankActionState,
  type UnlockActionState,
} from "@/app/account/bank/actions";
import { btnPrimary, btnSecondary } from "@/lib/button";
import { THAI_BANKS } from "@/lib/thai-banks";

const EMPTY: BankActionState = { ok: false, message: null };
const EMPTY_UNLOCK: UnlockActionState = { ok: false, message: null };

const inputClass = "rounded-lg border border-black/15 px-3 py-2";

export type BankAccountFormProps = {
  initial: { bankCode: string; accountNumber: string; accountName: string };
  /** Null until the first save; after that, what to show instead of the form. */
  masked: string | null;
  /** Whether an OTP has already opened the form for one change. */
  unlocked: boolean;
  /** Whether there is a verified number a code could be sent to at all. */
  hasVerifiedPhone: boolean;
};

/**
 * The payout account — open on first save, locked after.
 *
 * Three states, and which one you see is decided by the server, not by
 * anything the browser holds: no account yet (the plain form), a saved account
 * (masked, with an OTP behind the edit), or an account with a live unlock (the
 * form again, for exactly one save).
 */
export function BankAccountForm({
  initial,
  masked,
  unlocked,
  hasVerifiedPhone,
}: BankAccountFormProps) {
  const editable = masked === null || unlocked;

  if (!editable) {
    return (
      <LockedAccount masked={masked} hasVerifiedPhone={hasVerifiedPhone} />
    );
  }

  return <EditableForm initial={initial} unlocked={unlocked} />;
}

function LockedAccount({
  masked,
  hasVerifiedPhone,
}: {
  masked: string;
  hasVerifiedPhone: boolean;
}) {
  const [asking, setAsking] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-ink/70">บัญชีที่รับเงิน</span>
        <span className="text-lg font-medium tabular-nums">{masked}</span>
      </div>

      {asking ? (
        <UnlockSteps />
      ) : (
        <button
          type="button"
          className={`${btnSecondary} self-start`}
          onClick={() => setAsking(true)}
        >
          เปลี่ยนบัญชีธนาคาร
        </button>
      )}

      {!hasVerifiedPhone ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ต้องยืนยันเบอร์โทรศัพท์ก่อนจึงจะเปลี่ยนบัญชีได้
        </p>
      ) : null}
    </div>
  );
}

/** Send a code to the verified number, then take the code back. */
function UnlockSteps() {
  const [sendState, send, sending] = useActionState(
    sendBankUnlockOtpAction,
    EMPTY_UNLOCK,
  );

  return (
    <div className="flex flex-col gap-3">
      <form action={send}>
        <button type="submit" disabled={sending} className={btnPrimary}>
          {sending ? "กำลังส่ง…" : "ส่งรหัส OTP"}
        </button>
      </form>

      {sendState.message ? (
        <p
          role="status"
          className={`text-sm ${sendState.ok ? "text-green-700" : "text-brand"}`}
        >
          {sendState.message}
          {sendState.ok && sendState.refno ? ` (Ref: ${sendState.refno})` : null}
        </p>
      ) : null}

      {sendState.ok ? <UnlockVerifyStep /> : null}
    </div>
  );
}

function UnlockVerifyStep() {
  const [state, action, pending] = useActionState(
    verifyBankUnlockAction,
    EMPTY_UNLOCK,
  );

  // No success branch to render: the action revalidates the page, which comes
  // back with the form open. Showing "unlocked!" here and the form below it
  // would say the same thing twice.
  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[.02] p-4"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">รหัส OTP ที่ได้รับ</span>
        <input
          name="pin"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          className={`${inputClass} font-mono tracking-[0.3em]`}
        />
      </label>
      <button type="submit" disabled={pending} className={`${btnPrimary} self-start`}>
        {pending ? "กำลังตรวจสอบ…" : "ยืนยันรหัส"}
      </button>
      {state.message && !state.ok ? (
        <p role="status" className="text-sm text-brand">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function EditableForm({
  initial,
  unlocked,
}: {
  initial: BankAccountFormProps["initial"];
  unlocked: boolean;
}) {
  const [state, action, pending] = useActionState(saveBankAccountAction, EMPTY);

  // React resets an uncontrolled form once the action resolves, so a rejected
  // submission is re-seeded from what the server echoed back rather than from
  // the values the page first loaded with.
  const v = state.values ?? initial;
  const err = state.errors;

  return (
    <form action={action} className="flex flex-col gap-4">
      {unlocked ? (
        <p className="rounded-lg border border-black/10 px-4 py-3 text-sm text-ink/70">
          แก้ไขได้ 1 ครั้ง
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">ธนาคาร</span>
        <select name="bankCode" defaultValue={v.bankCode} className={inputClass}>
          <option value="">— เลือกธนาคาร —</option>
          {THAI_BANKS.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </select>
        {err?.bankCode ? <span className="text-brand">{err.bankCode}</span> : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">เลขที่บัญชี</span>
        <input
          name="accountNumber"
          inputMode="numeric"
          defaultValue={v.accountNumber}
          className={inputClass}
        />
        {err?.accountNumber ? (
          <span className="text-brand">{err.accountNumber}</span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">ชื่อบัญชี (ตามที่ธนาคารระบุ)</span>
        <input
          name="accountName"
          defaultValue={v.accountName}
          className={inputClass}
        />
        {err?.accountName ? (
          <span className="text-brand">{err.accountName}</span>
        ) : null}
      </label>

      <button
        type="submit"
        disabled={pending}
        className={`${btnPrimary} self-start`}
      >
        {pending ? "กำลังบันทึก…" : "บันทึกบัญชีธนาคาร"}
      </button>

      {state.message ? (
        <p className={`text-sm ${state.ok ? "text-green-700" : "text-brand"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
