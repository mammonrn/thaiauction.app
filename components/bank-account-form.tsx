"use client";

import { useActionState } from "react";

import {
  saveBankAccountAction,
  type BankActionState,
} from "@/app/account/bank/actions";
import { THAI_BANKS } from "@/lib/thai-banks";

const EMPTY: BankActionState = { ok: false, message: null };

export function BankAccountForm({
  initial,
}: {
  initial: { bankCode: string; accountNumber: string; accountName: string };
}) {
  const [state, action, pending] = useActionState(
    saveBankAccountAction,
    EMPTY,
  );

  // React resets an uncontrolled form once the action resolves, so a rejected
  // submission is re-seeded from what the server echoed back rather than from
  // the values the page first loaded with.
  const v = state.values ?? initial;
  const err = state.errors;

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-black/70 dark:text-white/70">ธนาคาร</span>
        <select
          name="bankCode"
          defaultValue={v.bankCode}
          className="rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-black"
        >
          <option value="">— เลือกธนาคาร —</option>
          {THAI_BANKS.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {bank.name}
            </option>
          ))}
        </select>
        {err?.bankCode ? (
          <span className="text-red-600 dark:text-red-400">{err.bankCode}</span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-black/70 dark:text-white/70">เลขที่บัญชี</span>
        <input
          name="accountNumber"
          inputMode="numeric"
          defaultValue={v.accountNumber}
          className="rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-black"
        />
        {err?.accountNumber ? (
          <span className="text-red-600 dark:text-red-400">
            {err.accountNumber}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-black/70 dark:text-white/70">
          ชื่อบัญชี (ตามที่ธนาคารระบุ)
        </span>
        <input
          name="accountName"
          defaultValue={v.accountName}
          className="rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-black"
        />
        {err?.accountName ? (
          <span className="text-red-600 dark:text-red-400">
            {err.accountName}
          </span>
        ) : null}
      </label>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "กำลังบันทึก…" : "บันทึกบัญชีธนาคาร"}
      </button>

      {state.message ? (
        <p
          className={`text-sm ${
            state.ok
              ? "text-green-700 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
