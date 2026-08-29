"use client";

import Link from "next/link";

import { btnSecondarySm } from "@/lib/button";

export type ShipToOption = {
  id: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
};

/**
 * Where the parcel goes, chosen before paying.
 *
 * The address is copied onto the order when the charge is reserved, so this is
 * the last screen on which the buyer gets to say. It is a radio list rather
 * than a form: the address book already exists at /account/addresses, and
 * asking someone to retype an address they have already saved is how you get
 * two slightly different versions of the same address.
 *
 * The chosen id is posted with the payment; the server re-reads that address
 * and checks it belongs to the payer, so the values here are display only.
 */
export function ShipToPicker({
  addresses,
  selectedId,
  onSelect,
  disabled,
}: {
  addresses: ShipToOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  if (addresses.length === 0) {
    return (
      <section className="flex flex-col items-start gap-2 rounded-xl border border-warning/35 bg-warning/12 p-5 text-sm">
        <h2 className="font-semibold text-warning">ยังไม่มีที่อยู่จัดส่ง</h2>
        <p className="text-warning">เพิ่มที่อยู่ก่อนจึงจะชำระเงินได้</p>
        <Link href="/account/addresses" className={btnSecondarySm}>
          เพิ่มที่อยู่จัดส่ง
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">ที่อยู่จัดส่ง</h2>
        <Link
          href="/account/addresses"
          className="text-xs text-info underline-offset-4 hover:underline"
        >
          จัดการที่อยู่
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {addresses.map((address) => (
          <label
            key={address.id}
            className="flex cursor-pointer gap-3 rounded-lg border border-black/15 px-3 py-2.5 text-sm has-checked:border-brand has-checked:bg-brand/[.06]"
          >
            <input
              type="radio"
              name="shipToId"
              value={address.id}
              checked={selectedId === address.id}
              disabled={disabled}
              onChange={() => onSelect(address.id)}
              className="mt-1 accent-brand"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">
                {address.recipientName} · {address.phone}
              </span>
              <span className="text-ink/60">
                {address.addressLine} ต.{address.subDistrict} อ.
                {address.district} จ.{address.province} {address.postalCode}
              </span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
