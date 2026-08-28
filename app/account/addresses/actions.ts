"use server";

import { revalidatePath } from "next/cache";

import {
  validateAddress,
  type AddressInput,
  type FieldErrors,
} from "@/lib/address-validation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export type AddressActionState = {
  ok: boolean;
  message: string | null;
  errors?: FieldErrors;
  /**
   * The values as submitted, echoed back on failure.
   *
   * React 19 resets an uncontrolled form once its action resolves, so without
   * this a rejected submission would wipe everything the user typed and make
   * them retype the whole address to fix one field.
   */
  values?: Record<keyof AddressInput, string>;
};

const GENERIC_FAILURE = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";

/**
 * Load an address only if it belongs to the signed-in user.
 *
 * Every mutation below funnels through this. The ownership test is part of the
 * WHERE clause rather than a separate read-then-compare, so guessing another
 * user's cuid simply matches nothing — there is no window between the check and
 * the write, and the caller cannot tell "not yours" apart from "doesn't exist".
 */
async function findOwnedAddress(addressId: string, userId: string) {
  if (!addressId) return null;

  return prisma.shippingAddress.findFirst({
    where: { id: addressId, userId },
    select: { id: true, isDefault: true },
  });
}

function readAddressForm(formData: FormData) {
  return {
    recipientName: String(formData.get("recipientName") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    addressLine: String(formData.get("addressLine") ?? ""),
    subDistrict: String(formData.get("subDistrict") ?? ""),
    district: String(formData.get("district") ?? ""),
    province: String(formData.get("province") ?? ""),
    postalCode: String(formData.get("postalCode") ?? ""),
  };
}

export async function createAddressAction(
  _prev: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const { user } = await requireSession("/account/addresses");

  const submitted = readAddressForm(formData);
  const parsed = validateAddress(submitted);
  if (!parsed.ok) {
    return {
      ok: false,
      message: "กรุณาตรวจสอบข้อมูลที่กรอก",
      errors: parsed.errors,
      values: submitted,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // The very first address a user saves becomes their default, so there is
      // always something for checkout to pick.
      const existing = await tx.shippingAddress.count({
        where: { userId: user.id },
      });

      await tx.shippingAddress.create({
        data: { ...parsed.value, userId: user.id, isDefault: existing === 0 },
      });
    });
  } catch (error) {
    console.error("[addresses] create failed:", error);
    return { ok: false, message: GENERIC_FAILURE };
  }

  revalidatePath("/account/addresses");
  return { ok: true, message: "เพิ่มที่อยู่เรียบร้อยแล้ว" };
}

export async function updateAddressAction(
  _prev: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const { user } = await requireSession("/account/addresses");

  const addressId = String(formData.get("addressId") ?? "");
  const owned = await findOwnedAddress(addressId, user.id);
  if (!owned) {
    return { ok: false, message: "ไม่พบที่อยู่นี้" };
  }

  const submitted = readAddressForm(formData);
  const parsed = validateAddress(submitted);
  if (!parsed.ok) {
    return {
      ok: false,
      message: "กรุณาตรวจสอบข้อมูลที่กรอก",
      errors: parsed.errors,
      values: submitted,
    };
  }

  try {
    // userId is repeated in the WHERE clause so the write itself is scoped to
    // the owner, not just the lookup above.
    await prisma.shippingAddress.updateMany({
      where: { id: owned.id, userId: user.id },
      data: parsed.value,
    });
  } catch (error) {
    console.error("[addresses] update failed:", error);
    return { ok: false, message: GENERIC_FAILURE };
  }

  revalidatePath("/account/addresses");
  return { ok: true, message: "แก้ไขที่อยู่เรียบร้อยแล้ว" };
}

export async function deleteAddressAction(
  _prev: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const { user } = await requireSession("/account/addresses");

  const addressId = String(formData.get("addressId") ?? "");
  const owned = await findOwnedAddress(addressId, user.id);
  if (!owned) {
    return { ok: false, message: "ไม่พบที่อยู่นี้" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.shippingAddress.deleteMany({
        where: { id: owned.id, userId: user.id },
      });

      // Nothing deleted means someone else removed it first — don't then go
      // promoting a replacement default for a delete that didn't happen.
      if (deleted.count === 0) return;

      // Deleting the default would leave the user with none, so promote the
      // oldest remaining address. Same transaction, so there is never a moment
      // with zero defaults while other addresses exist.
      if (owned.isDefault) {
        const next = await tx.shippingAddress.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });

        if (next) {
          await tx.shippingAddress.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }
    });
  } catch (error) {
    console.error("[addresses] delete failed:", error);
    return { ok: false, message: GENERIC_FAILURE };
  }

  revalidatePath("/account/addresses");
  return { ok: true, message: "ลบที่อยู่เรียบร้อยแล้ว" };
}

export async function setDefaultAddressAction(
  _prev: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const { user } = await requireSession("/account/addresses");

  const addressId = String(formData.get("addressId") ?? "");
  const owned = await findOwnedAddress(addressId, user.id);
  if (!owned) {
    return { ok: false, message: "ไม่พบที่อยู่นี้" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Clear first, then set. A partial unique index in the database allows at
      // most one default row per user, and this order never leaves two set at
      // the same time, so the statement can't trip it.
      await tx.shippingAddress.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false },
      });

      await tx.shippingAddress.updateMany({
        where: { id: owned.id, userId: user.id },
        data: { isDefault: true },
      });
    });
  } catch (error) {
    console.error("[addresses] setDefault failed:", error);
    return { ok: false, message: GENERIC_FAILURE };
  }

  revalidatePath("/account/addresses");
  return { ok: true, message: "ตั้งเป็นที่อยู่เริ่มต้นแล้ว" };
}
