"use client";

import { useActionState, useCallback, useRef, useState } from "react";

import {
  createAddressAction,
  deleteAddressAction,
  setDefaultAddressAction,
  updateAddressAction,
  type AddressActionState,
} from "@/app/account/addresses/actions";
import { AddressForm, type AddressFormValues } from "@/components/address-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { btnDangerSm, btnPrimary, btnSecondarySm } from "@/lib/button";

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
        <div className="rounded-xl border border-dashed border-black/20 px-5 py-10 text-center">
          <p className="font-medium">ยังไม่มีที่อยู่จัดส่ง</p>
          <p className="mt-1 text-sm text-ink/60">
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
          className={`${btnPrimary} self-start`}
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
    <div className="flex flex-col gap-3 rounded-xl bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{address.recipientName}</span>
        {isDefault ? (
          <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-xs font-medium text-success">
            ค่าเริ่มต้น
          </span>
        ) : null}
      </div>

      <p className="text-sm text-ink/70">
        {address.addressLine} ต.{address.subDistrict} อ.{address.district}{" "}
        จ.{address.province} {address.postalCode}
      </p>
      <p className="text-sm text-ink/60">
        โทร. {address.phone}
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onEdit}
          className={btnSecondarySm}
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
        className={danger ? btnDangerSm : btnSecondarySm}
      >
        {pending ? pendingLabel : label}
      </button>
      {state.message && !state.ok ? (
        <span role="alert" className="text-sm text-brand">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/** Delete, behind the shared confirm. */
function DeleteButton({ addressId }: { addressId: string }) {
  const [asking, setAsking] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    deleteAddressAction,
    initialState,
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={pending}
        className={btnDangerSm}
      >
        {pending ? "กำลังลบ…" : "ลบ"}
      </button>

      {/* The dialog's confirm is a plain button, so the form is submitted
          through a ref rather than by nesting it inside <dialog> — a form in
          the top layer loses its place in the page's submit order. */}
      <form ref={form} action={formAction} className="hidden">
        <input type="hidden" name="addressId" value={addressId} />
      </form>

      {state.message && !state.ok ? (
        <span role="alert" className="text-sm text-brand">
          {state.message}
        </span>
      ) : null}

      <ConfirmDialog
        open={asking}
        title="ลบที่อยู่นี้?"
        confirmLabel="ลบที่อยู่"
        pending={pending}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          form.current?.requestSubmit();
        }}
      />
    </>
  );
}
