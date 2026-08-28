"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type { AddressActionState } from "@/app/account/addresses/actions";
import { ADDRESS_FIELD_MAX } from "@/lib/address-validation";
import {
  ensureIndexLoaded,
  getIndexSnapshot,
  getServerIndexSnapshot,
  isLookupablePostalCode,
  lookupPostalCode,
  subscribeToIndex,
  unique,
} from "@/lib/postcode-lookup";

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

/** Sentinel option that switches a dropdown back to a free-text input. */
const CUSTOM = "__custom__";

type GeoField = "province" | "district" | "subDistrict";

/**
 * The value to show for one geo field: whatever the user explicitly set,
 * otherwise the postcode's answer when it leaves exactly one possibility.
 * An ambiguous field resolves to "" so the dropdown asks rather than guesses.
 */
function resolve(chosen: string | undefined, options: string[]): string {
  if (chosen !== undefined) return chosen;
  return options.length === 1 ? options[0] : "";
}

export function AddressForm({
  action,
  initial,
  submitLabel,
  onCancel,
  onSuccess,
}: Props) {
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state.ok, onSuccess]);

  const err = state.errors;
  const v = state.values ?? initial;

  // Only the postcode and the user's explicit choices are state. Everything the
  // postcode determines is derived during render, so there are no effects
  // copying resolved values into state and re-rendering behind them.
  const [postalCode, setPostalCode] = useState(v?.postalCode ?? "");
  const [chosen, setChosen] = useState<Partial<Record<GeoField, string>>>({
    province: v?.province,
    district: v?.district,
    subDistrict: v?.subDistrict,
  });
  // Fields where the user picked "กรอกเอง" and wants a text box, not a dropdown.
  const [manual, setManual] = useState<Record<GeoField, boolean>>({
    province: false,
    district: false,
    subDistrict: false,
  });

  // Start the download as soon as the form opens. It is only mounted when the
  // user deliberately opens "add"/"edit", so this is not speculative, and it
  // means the lookup is already in memory by the time they reach the postcode
  // field instead of stalling on a download right when they need the answer.
  // No setState here, so it does not cause a cascading render.
  useEffect(() => {
    ensureIndexLoaded();
  }, []);

  const index = useSyncExternalStore(
    subscribeToIndex,
    getIndexSnapshot,
    getServerIndexSnapshot,
  );

  const areas = useMemo(
    () => lookupPostalCode(index, postalCode),
    [index, postalCode],
  );

  // Candidates cascade: each field narrows the ones below it.
  const provinceOptions = useMemo(
    () => unique(areas.map((a) => a.province)),
    [areas],
  );
  const province = resolve(chosen.province, provinceOptions);

  const districtOptions = useMemo(() => {
    // If the user typed a province the dataset doesn't know, scoping by it
    // would match nothing and blank the district. Fall back to the whole
    // postcode instead: those districts are still the best candidates.
    const scoped = areas.filter((a) => a.province === province);
    return unique((scoped.length > 0 ? scoped : areas).map((a) => a.district));
  }, [areas, province]);
  const district = resolve(chosen.district, districtOptions);

  const subDistrictOptions = useMemo(() => {
    const inProvince = areas.filter((a) => a.province === province);
    const pool = inProvince.length > 0 ? inProvince : areas;
    const inDistrict = pool.filter((a) => a.district === district);
    return unique((inDistrict.length > 0 ? inDistrict : pool).map((a) => a.subDistrict));
  }, [areas, province, district]);
  const subDistrict = resolve(chosen.subDistrict, subDistrictOptions);

  function handlePostalCodeChange(next: string) {
    const digits = next.replace(/\D/g, "");
    setPostalCode(digits);

    if (isLookupablePostalCode(digits)) {
      // Side effect in an event handler, not in render or an effect.
      ensureIndexLoaded();
    }

    // A new postcode invalidates earlier picks; clearing them lets the values
    // below be derived from the new area list instead of lingering.
    setChosen({});
    setManual({ province: false, district: false, subDistrict: false });
  }

  function setField(field: GeoField, value: string) {
    setChosen((c) => {
      const next: Partial<Record<GeoField, string>> = { ...c, [field]: value };

      // Picking a real area invalidates any narrower pick that cannot sit
      // inside it. Guarded by pool.length, so typing a value the dataset does
      // not know prunes nothing and never discards what the user entered.
      if (field === "province") {
        const pool = areas.filter((a) => a.province === value);
        if (pool.length > 0) {
          if (next.district && !pool.some((a) => a.district === next.district)) {
            delete next.district;
          }
          if (
            next.subDistrict &&
            !pool.some((a) => a.subDistrict === next.subDistrict)
          ) {
            delete next.subDistrict;
          }
        }
      }

      if (field === "district") {
        const pool = areas.filter((a) => a.district === value);
        if (
          pool.length > 0 &&
          next.subDistrict &&
          !pool.some((a) => a.subDistrict === next.subDistrict)
        ) {
          delete next.subDistrict;
        }
      }

      return next;
    });
  }

  const geo = {
    province: { value: province, options: provinceOptions },
    district: { value: district, options: districtOptions },
    subDistrict: { value: subDistrict, options: subDistrictOptions },
  } as const;

  function renderGeoField(
    field: GeoField,
    label: string,
    error?: string,
  ) {
    const { value, options } = geo[field];
    const asDropdown = options.length > 1 && !manual[field];

    if (asDropdown) {
      return (
        <SelectField
          label={label}
          name={field}
          value={value}
          options={options}
          error={error}
          onChange={(next) => {
            if (next === CUSTOM) {
              setManual((m) => ({ ...m, [field]: true }));
              setField(field, "");
              return;
            }
            setField(field, next);
          }}
        />
      );
    }

    return (
      <Field
        label={label}
        name={field}
        value={value}
        onChange={(e) => setField(field, e.target.value)}
        maxLength={ADDRESS_FIELD_MAX[field]}
        error={error}
        hint={
          options.length > 1 && manual[field]
            ? "กำลังกรอกเอง — ล้างรหัสไปรษณีย์แล้วกรอกใหม่เพื่อกลับไปเลือกจากรายการ"
            : undefined
        }
      />
    );
  }

  const unknownPostcode =
    isLookupablePostalCode(postalCode) && areas.length === 0;

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

      {/* Postcode first: filling it in populates the three fields below. */}
      <Field
        label="รหัสไปรษณีย์"
        name="postalCode"
        value={postalCode}
        onChange={(e) => handlePostalCodeChange(e.target.value)}
        maxLength={5}
        error={err?.postalCode}
        inputMode="numeric"
        pattern="[1-9][0-9]{4}"
        autoComplete="postal-code"
        hint={
          unknownPostcode
            ? undefined
            : "กรอกรหัสไปรษณีย์ 5 หลัก แล้วระบบจะเติมจังหวัด/อำเภอ/ตำบลให้"
        }
      />

      {unknownPostcode ? (
        <p className="-mt-2 text-xs text-amber-700 dark:text-amber-500">
          ไม่พบรหัสไปรษณีย์นี้ในฐานข้อมูล กรุณากรอกจังหวัด/อำเภอ/ตำบลเอง
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {renderGeoField("province", "จังหวัด", err?.province)}
        {renderGeoField("district", "อำเภอ/เขต", err?.district)}
        {renderGeoField("subDistrict", "ตำบล/แขวง", err?.subDistrict)}
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

function SelectField({
  label,
  name,
  value,
  options,
  error,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: string[];
  error?: string;
  onChange: (next: string) => void;
}) {
  const errorId = error ? `${name}-error` : undefined;

  // A saved address may hold a name the current dataset no longer lists (areas
  // get renamed or split). Without this the <select> would silently show no
  // selection and the user could save a blank field by accident.
  const shown = value && !options.includes(value) ? [value, ...options] : options;

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <select
        name={name}
        value={value}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        <option value="" disabled>
          เลือก{label} ({options.length} ตัวเลือก)
        </option>
        {shown.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={CUSTOM}>อื่นๆ (กรอกเอง)</option>
      </select>
      {error ? (
        <span id={errorId} className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function Field({
  label,
  name,
  maxLength,
  error,
  hint,
  ...rest
}: {
  label: string;
  name: string;
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
