"use client";

import { useActionState, useCallback, useState } from "react";

import {
  createAddressAction,
  deleteAddressAction,
  setDefaultAddressAction,
  updateAddressAction,
  type AddressActionState,
} from "@/app/account/addresses/actions";
import { AddressForm, type AddressFormValues } from "@/components/address-form";

type Mode = { type: "none" } | { type: "new" } | { type: "edit"; id: string };

/** A saved address as rendered in the list: the form fields plus its flag. */
export type AddressListItem = AddressFormValues & { isDefault: boolean };

const initialState: AddressActionState = { ok: false, message: null };

export function AddressManager({
  addresses,
}: {
  addresses: AddressListItem[];
}) {
  const [mode, setMode] = useState<Mode>({ type: "none" });
  const close = useCallback(() => setMode({ type: "none" }), []);

  return (
    <div className="flex flex-col gap-6">
      {addresses.length === 0 && mode.type !== "new" ? (
        <div className="rounded-xl border border-dashed border-black/20 px-5 py-10 text-center dark:border-white/20">
          <p className="font-medium">ยังไม่มีที่อยู่จัดส่ง</p>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            เพิ่มที่อยู่ไว้เพื่อให้กรอกตอนชนะประมูลได้เร็วขึ้น
          </p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-4">
        {addresses.map((address) =>
          mode.type === "edit" && mode.id === address.id ? (
            <li key={address.id}>
              <AddressForm
                // Remount per address so the form never shows another row's
                // stale values or error state.
                key={`edit-${address.id}`}
                action={updateAddressAction}
                initial={address}
                submitLabel="บันทึกการแก้ไข"
                onCancel={close}
                onSuccess={close}
              />
            </li>
          ) : (
            <li key={address.id}>
              <AddressCard
                address={address}
                isDefault={address.isDefault}
                onEdit={() => setMode({ type: "edit", id: address.id })}
              />
            </li>
          ),
        )}
      </ul>

      {mode.type === "new" ? (
        <AddressForm
          key="new"
          action={createAddressAction}
          submitLabel="บันทึกที่อยู่"
          onCancel={close}
          onSuccess={close}
        />
      ) : (
        <button
          type="button"
          onClick={() => setMode({ type: "new" })}
          className="self-start rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90"
        >
          เพิ่มที่อยู่ใหม่
        </button>
      )}
    </div>
  );
}

function AddressCard({
  address,
  isDefault,
  onEdit,
}: {
  address: AddressListItem;
  isDefault: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/10 p-5 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{address.recipientName}</span>
        {isDefault ? (
          <span className="rounded-full bg-green-600/10 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
            ค่าเริ่มต้น
          </span>
        ) : null}
      </div>

      <p className="text-sm text-black/70 dark:text-white/70">
        {address.addressLine} ต.{address.subDistrict} อ.{address.district}{" "}
        จ.{address.province} {address.postalCode}
      </p>
      <p className="text-sm text-black/60 dark:text-white/60">
        โทร. {address.phone}
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          แก้ไข
        </button>

        {isDefault ? null : (
          <SingleButtonForm
            action={setDefaultAddressAction}
            addressId={address.id}
            label="ตั้งเป็นค่าเริ่มต้น"
            pendingLabel="กำลังตั้ง…"
          />
        )}

        <DeleteButton addressId={address.id} />
      </div>
    </div>
  );
}

/** A form whose only input is the address id, for one-click mutations. */
function SingleButtonForm({
  action,
  addressId,
  label,
  pendingLabel,
  danger,
}: {
  action: (
    prev: AddressActionState,
    formData: FormData,
  ) => Promise<AddressActionState>;
  addressId: string;
  label: string;
  pendingLabel: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="addressId" value={addressId} />
      <button
        type="submit"
        disabled={pending}
        className={
          danger
            ? "rounded-lg border border-red-600/40 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-600/10 disabled:opacity-60 dark:text-red-400"
            : "rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
        }
      >
        {pending ? pendingLabel : label}
      </button>
      {state.message && !state.ok ? (
        <span role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/**
 * Two-step delete. An inline confirm rather than window.confirm, which is
 * blocking, unstyled, and suppressible by the browser.
 */
function DeleteButton({ addressId }: { addressId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-red-600/40 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-600/10 dark:text-red-400"
      >
        ลบ
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-black/70 dark:text-white/70">ยืนยันลบ?</span>
      <SingleButtonForm
        action={deleteAddressAction}
        addressId={addressId}
        label="ลบเลย"
        pendingLabel="กำลังลบ…"
        danger
      />
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
      >
        ยกเลิก
      </button>
    </span>
  );
}
