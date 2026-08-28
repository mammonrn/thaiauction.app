"use client";

import { useActionState } from "react";

import {
  saveIdentityAction,
  type IdentityActionState,
} from "@/app/account/verification/actions";
import { MAX_NAME_LENGTH } from "@/lib/identity";
import { btnPrimary } from "@/lib/button";

const initialState: IdentityActionState = { ok: false, message: null };

const inputClass =
  "rounded-lg border border-black/15 px-3 py-2";

export type IdentityValues = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
};

export function IdentityForm({
  initial,
  maxDateOfBirth,
}: {
  initial: IdentityValues;
  /** Today, from the server, so the picker cannot offer a future date. */
  maxDateOfBirth: string;
}) {
  const [state, action, pending] = useActionState(saveIdentityAction, initialState);
  const v = state.values ?? initial;
  const err = state.errors;

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="ชื่อจริง (ตามบัตร)"
          name="firstName"
          defaultValue={v.firstName}
          maxLength={MAX_NAME_LENGTH}
          error={err?.firstName}
          autoComplete="given-name"
        />
        <Field
          label="นามสกุล (ตามบัตร)"
          name="lastName"
          defaultValue={v.lastName}
          maxLength={MAX_NAME_LENGTH}
          error={err?.lastName}
          autoComplete="family-name"
        />
      </div>

      <Field
        label="วันเกิด"
        name="dateOfBirth"
        type="date"
        defaultValue={v.dateOfBirth}
        max={maxDateOfBirth}
        error={err?.dateOfBirth}
        autoComplete="bday"
        className="max-w-56"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={btnPrimary}
        >
          {pending ? "กำลังบันทึก…" : "บันทึกข้อมูล"}
        </button>
        {state.message ? (
          <span
            role={state.ok ? "status" : "alert"}
            className={
              state.ok
                ? "text-sm text-green-700"
                : "text-sm text-red-600"
            }
          >
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  className,
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const errorId = error ? `${name}-error` : undefined;

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={`${inputClass} ${className ?? ""}`}
        {...rest}
      />
      {error ? (
        <span id={errorId} className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
    </label>
  );
}
