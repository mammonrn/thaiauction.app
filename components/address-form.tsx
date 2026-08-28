"use client";

import { useActionState, useEffect } from "react";

import type { AddressActionState } from "@/app/account/addresses/actions";
import { ADDRESS_FIELD_MAX } from "@/lib/address-validation";

export type AddressFormValues = {
  id: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
};

type Props = {
  action: (
    prev: AddressActionState,
    formData: FormData,
  ) => Promise<AddressActionState>;
  initial?: AddressFormValues;
  submitLabel: string;
  onCancel: () => void;
  onSuccess: () => void;
};

const initialState: AddressActionState = { ok: false, message: null };

const inputClass =
  "rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-white/5";

export function AddressForm({
  action,
  initial,
  submitLabel,
  onCancel,
  onSuccess,
}: Props) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // The server revalidates the page on success, so the fresh list arrives as
  // new props; all this needs to do is close the form. In an effect rather than
  // during render, so it fires once per successful submit instead of on every
  // subsequent re-render.
  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state.ok, onSuccess]);

  const err = state.errors;

  // Prefer what the user just submitted (echoed back by the action when
  // validation failed) over the row's saved values, so a rejected submit keeps
  // their edits instead of reverting the fields.
  const v = state.values ?? initial;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-xl border border-black/10 bg-black/[.02] p-5 dark:border-white/15 dark:bg-white/5"
    >
      {initial ? <input type="hidden" name="addressId" value={initial.id} /> : null}

      <Field
        label="ชื่อผู้รับ"
        name="recipientName"
        defaultValue={v?.recipientName}
        maxLength={ADDRESS_FIELD_MAX.recipientName}
        error={err?.recipientName}
        autoComplete="name"
      />

      <Field
        label="เบอร์โทรศัพท์"
        name="phone"
        defaultValue={v?.phone}
        maxLength={ADDRESS_FIELD_MAX.phone}
        error={err?.phone}
        autoComplete="tel"
        inputMode="tel"
        hint="มือถือ 10 หลัก (08x-xxx-xxxx) หรือเบอร์บ้าน 9 หลัก (02-xxx-xxxx)"
      />

      <Field
        label="ที่อยู่ (บ้านเลขที่ ถนน อาคาร)"
        name="addressLine"
        defaultValue={v?.addressLine}
        maxLength={ADDRESS_FIELD_MAX.addressLine}
        error={err?.addressLine}
        autoComplete="street-address"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="ตำบล/แขวง"
          name="subDistrict"
          defaultValue={v?.subDistrict}
          maxLength={ADDRESS_FIELD_MAX.subDistrict}
          error={err?.subDistrict}
        />
        <Field
          label="อำเภอ/เขต"
          name="district"
          defaultValue={v?.district}
          maxLength={ADDRESS_FIELD_MAX.district}
          error={err?.district}
        />
        <Field
          label="จังหวัด"
          name="province"
          defaultValue={v?.province}
          maxLength={ADDRESS_FIELD_MAX.province}
          error={err?.province}
        />
        <Field
          label="รหัสไปรษณีย์"
          name="postalCode"
          defaultValue={v?.postalCode}
          maxLength={5}
          error={err?.postalCode}
          inputMode="numeric"
          pattern="[1-9][0-9]{4}"
          autoComplete="postal-code"
        />
      </div>

      {state.message && !state.ok ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      ) : null}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "กำลังบันทึก…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-black/15 px-4 py-2.5 text-sm font-medium transition hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  maxLength,
  error,
  hint,
  ...rest
}: {
  label: string;
  name: string;
  defaultValue?: string;
  maxLength?: number;
  error?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const errorId = error ? `${name}-error` : undefined;

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        maxLength={maxLength}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={inputClass}
        {...rest}
      />
      {hint && !error ? (
        <span className="text-xs text-black/50 dark:text-white/50">{hint}</span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : null}
    </label>
  );
}
