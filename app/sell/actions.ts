"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  isEditable,
  validateAuctionInput,
  type AuctionFieldErrors,
} from "@/lib/auction-rules";
import { isItemCondition } from "@/lib/condition";
import { bahtToSatang } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireVerifiedSeller } from "@/lib/seller";
import { requireSession } from "@/lib/session";
import { UploadError, attachImagesToItem, deleteImages } from "@/lib/uploads";

export type SellActionState = {
  ok: boolean;
  message: string | null;
  errors?: AuctionFieldErrors;
  values?: Record<string, string>;
};

const GENERIC_FAILURE = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";

/**
 * Load a listing only if it belongs to the signed-in seller.
 *
 * userId sits in the WHERE clause rather than being compared after the read, so
 * a guessed id simply matches nothing and "not yours" is indistinguishable from
 * "does not exist" — the same rule the shipping addresses follow.
 */
async function findOwnedItem(itemId: string, sellerId: string) {
  if (!itemId) return null;

  return prisma.auctionItem.findFirst({
    where: { id: itemId, sellerId },
    select: {
      id: true,
      status: true,
      images: true,
      createdAt: true,
      _count: { select: { bids: true } },
    },
  });
}

function parsePrice(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const baht = Number(trimmed);
  if (!Number.isFinite(baht) || baht < 0) return null;
  return bahtToSatang(baht);
}

/**
 * Which button was pressed.
 *
 * Anything but an explicit "publish" is treated as a draft save, so a form
 * submitted by pressing Enter — which posts no button value at all — saves
 * rather than publishes. The safe reading is the default.
 */
function wantsPublish(formData: FormData): boolean {
  return String(formData.get("intent") ?? "") === "publish";
}

function readForm(formData: FormData) {
  const timed = formData.get("auctionType") === "timed";
  const endTimeRaw = String(formData.get("endTime") ?? "").trim();

  return {
    categoryId: String(formData.get("categoryId") ?? ""),
    condition: String(formData.get("condition") ?? ""),
    title: String(formData.get("title") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    startPriceRaw: String(formData.get("startPrice") ?? ""),
    buyNowPriceRaw: String(formData.get("buyNowPrice") ?? ""),
    bidIncrementRaw: String(formData.get("bidIncrement") ?? ""),
    timed,
    endTimeRaw,
    // The client posts one hidden input per image, in display order.
    images: formData.getAll("images").map(String).filter(Boolean),
  };
}

function echo(form: ReturnType<typeof readForm>): Record<string, string> {
  return {
    categoryId: form.categoryId,
    condition: form.condition,
    title: form.title,
    description: form.description,
    startPrice: form.startPriceRaw,
    buyNowPrice: form.buyNowPriceRaw,
    bidIncrement: form.bidIncrementRaw,
    auctionType: form.timed ? "timed" : "open",
    endTime: form.endTimeRaw,
  };
}

/** Shared parse + validate for create and update. */
function buildInput(
  form: ReturnType<typeof readForm>,
  requireImages: boolean,
  createdAt?: Date,
) {
  const startPriceSatang = parsePrice(form.startPriceRaw);
  const buyNowPriceSatang = parsePrice(form.buyNowPriceRaw);
  const bidIncrementSatang = parsePrice(form.bidIncrementRaw);
  const endTime =
    form.timed && form.endTimeRaw ? new Date(form.endTimeRaw) : null;

  const input = {
    categoryId: form.categoryId,
    condition: form.condition,
    title: form.title,
    description: form.description,
    startPriceSatang: startPriceSatang ?? -1,
    buyNowPriceSatang,
    // -1 rather than the default, so a blank or unparseable value is reported
    // instead of silently becoming ฿10.
    bidIncrementSatang: bidIncrementSatang ?? -1,
    endTime,
    images: form.images,
    createdAt,
  };

  const errors = validateAuctionInput(input, { requireImages });

  // Narrowed before it reaches Prisma: the column is an enum, and a posted
  // value that is not one of its members must be a validation error rather
  // than a database exception.
  if (!errors.condition && !isItemCondition(input.condition)) {
    errors.condition = "สภาพสินค้าไม่ถูกต้อง";
  }

  // A timed auction with no date at all is a separate mistake from a bad date.
  if (form.timed && !form.endTimeRaw) {
    errors.endTime = "กรุณาเลือกวันและเวลาที่จบ";
  }

  return { input, errors };
}

export async function createAuctionAction(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const { user } = await requireVerifiedSeller("/sell/new");

  const form = readForm(formData);
  const publishing = wantsPublish(formData);
  // Publishing straight from the form is held to the publish-time rules, not
  // the draft ones: a listing with no photograph is a fine draft and not a
  // fine listing. Refused here, before anything is written, so the seller gets
  // the field errors back on the form they are already looking at.
  const { input, errors } = buildInput(form, publishing);

  // The category must exist, or the foreign key would fail with a raw error.
  if (input.categoryId) {
    const category = await prisma.category.count({ where: { id: input.categoryId } });
    if (category === 0) errors.categoryId = "หมวดหมู่ไม่ถูกต้อง";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "กรุณาตรวจสอบข้อมูล", errors, values: echo(form) };
  }

  let itemId: string;
  try {
    // Created first with no images, so the item id exists to name their folder;
    // the staged files are then moved in and the row updated with their keys.
    const created = await prisma.auctionItem.create({
      data: {
        sellerId: user.id,
        categoryId: input.categoryId,
        condition: isItemCondition(input.condition) ? input.condition : null,
        title: input.title,
        description: input.description,
        images: [],
        startPrice: input.startPriceSatang,
        // The opening bid is the current price until somebody bids.
        currentPrice: input.startPriceSatang,
        buyNowPrice: input.buyNowPriceSatang,
        bidIncrement: input.bidIncrementSatang,
        endTime: input.endTime,
        status: "draft",
      },
      select: { id: true },
    });
    itemId = created.id;

    const stored = await attachImagesToItem(user.id, itemId, input.images);
    if (stored.length > 0) {
      await prisma.auctionItem.update({
        where: { id: itemId },
        data: { images: stored },
      });
    }

    // Created as a draft either way, because the images cannot be attached
    // until the row exists to name their folder. Going live is a second
    // statement, guarded on status so nothing that is already active can be
    // published twice.
    if (publishing) {
      await prisma.auctionItem.updateMany({
        where: { id: itemId, sellerId: user.id, status: "draft" },
        data: { status: "active" },
      });
    }
  } catch (error) {
    if (error instanceof UploadError) {
      return { ok: false, message: error.message, values: echo(form) };
    }
    console.error("[sell] create failed:", error);
    return { ok: false, message: GENERIC_FAILURE, values: echo(form) };
  }

  revalidatePath("/sell");

  // Published listings go to the public page, so the seller sees the thing
  // they just made where a buyer would see it. A draft has no public page, so
  // it goes back to its own editor.
  if (publishing) {
    revalidatePath(`/auctions/${itemId}`);
    redirect(`/auctions/${itemId}?published=1`);
  }
  redirect(`/sell/${itemId}/edit?created=1`);
}

export async function updateAuctionAction(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const { user } = await requireSession("/sell");

  const itemId = String(formData.get("itemId") ?? "");
  const owned = await findOwnedItem(itemId, user.id);
  if (!owned) return { ok: false, message: "ไม่พบรายการนี้" };

  // Re-checked here, not just hidden in the UI: a stale tab could post an edit
  // after the first bid arrives.
  if (!isEditable({ status: owned.status, bidCount: owned._count.bids })) {
    return { ok: false, message: "รายการนี้แก้ไขไม่ได้แล้ว" };
  }

  const form = readForm(formData);
  // Only a draft can be published; pressing it on a live listing would be
  // asking to publish something already published.
  const publishing = wantsPublish(formData) && owned.status === "draft";
  const { input, errors } = buildInput(
    form,
    // Strict when the listing is already live, and equally strict when this
    // save is going to make it live.
    owned.status === "active" || publishing,
    owned.createdAt,
  );

  if (input.categoryId) {
    const category = await prisma.category.count({ where: { id: input.categoryId } });
    if (category === 0) errors.categoryId = "หมวดหมู่ไม่ถูกต้อง";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "กรุณาตรวจสอบข้อมูล", errors, values: echo(form) };
  }

  try {
    const stored = await attachImagesToItem(user.id, owned.id, input.images);

    await prisma.auctionItem.updateMany({
      where: { id: owned.id, sellerId: user.id },
      data: {
        categoryId: input.categoryId,
        condition: isItemCondition(input.condition) ? input.condition : null,
        title: input.title,
        description: input.description,
        images: stored,
        startPrice: input.startPriceSatang,
        // Safe to move while there are no bids; the edit gate above guarantees
        // that, so this can never overwrite a real bid.
        currentPrice: input.startPriceSatang,
        buyNowPrice: input.buyNowPriceSatang,
        bidIncrement: input.bidIncrementSatang,
        endTime: input.endTime,
      },
    });

    // Images dropped in this edit are removed from disk, so deleted photos do
    // not linger on the VPS.
    const removed = owned.images.filter((key) => !stored.includes(key));
    await deleteImages(removed);

    if (publishing) {
      await prisma.auctionItem.updateMany({
        where: { id: owned.id, sellerId: user.id, status: "draft" },
        data: { status: "active" },
      });
    }
  } catch (error) {
    if (error instanceof UploadError) {
      return { ok: false, message: error.message, values: echo(form) };
    }
    console.error("[sell] update failed:", error);
    return { ok: false, message: GENERIC_FAILURE, values: echo(form) };
  }

  revalidatePath("/sell");
  revalidatePath(`/sell/${owned.id}/edit`);
  revalidatePath(`/auctions/${owned.id}`);

  if (publishing) redirect(`/auctions/${owned.id}?published=1`);
  return { ok: true, message: "บันทึกการแก้ไขแล้ว" };
}

/** draft -> active. Only now are the publish-time rules enforced. */
export async function publishAuctionAction(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const { user } = await requireVerifiedSeller("/sell");

  const itemId = String(formData.get("itemId") ?? "");
  const owned = await findOwnedItem(itemId, user.id);
  if (!owned) return { ok: false, message: "ไม่พบรายการนี้" };
  if (owned.status !== "draft") {
    return { ok: false, message: "รายการนี้เผยแพร่ไปแล้ว" };
  }

  const item = await prisma.auctionItem.findFirstOrThrow({
    where: { id: owned.id, sellerId: user.id },
  });

  const errors = validateAuctionInput(
    {
      categoryId: item.categoryId,
      // A draft created before this field existed has no answer. Publishing
      // asks for one rather than inventing it; the edit form is right there.
      condition: item.condition ?? "",
      title: item.title,
      description: item.description,
      startPriceSatang: item.startPrice,
      buyNowPriceSatang: item.buyNowPrice,
      bidIncrementSatang: item.bidIncrement,
      endTime: item.endTime,
      createdAt: item.createdAt,
      images: item.images,
    },
    { requireImages: true },
  );

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      message: "ยังเผยแพร่ไม่ได้ กรุณาแก้ไขให้ครบก่อน",
      errors,
    };
  }

  // Guarded on status as well as owner, so two clicks cannot publish twice.
  const { count } = await prisma.auctionItem.updateMany({
    where: { id: owned.id, sellerId: user.id, status: "draft" },
    data: { status: "active" },
  });

  if (count === 0) return { ok: false, message: "รายการนี้เผยแพร่ไปแล้ว" };

  revalidatePath("/sell");
  revalidatePath(`/auctions/${owned.id}`);
  // Every route to publishing ends in the same place: the listing as a buyer
  // sees it. Finishing on the form the seller has just left is the complaint
  // this fixes — they never got to see that the item actually went up.
  redirect(`/auctions/${owned.id}?published=1`);
}

/** Drafts can be deleted outright; anything published is cancelled instead. */
export async function deleteDraftAction(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const { user } = await requireSession("/sell");

  const itemId = String(formData.get("itemId") ?? "");
  const owned = await findOwnedItem(itemId, user.id);
  if (!owned) return { ok: false, message: "ไม่พบรายการนี้" };

  if (owned.status !== "draft") {
    return { ok: false, message: "ลบได้เฉพาะรายการที่ยังเป็นฉบับร่าง" };
  }

  try {
    const { count } = await prisma.auctionItem.deleteMany({
      where: { id: owned.id, sellerId: user.id, status: "draft" },
    });
    if (count > 0) await deleteImages(owned.images);
  } catch (error) {
    console.error("[sell] delete failed:", error);
    return { ok: false, message: GENERIC_FAILURE };
  }

  revalidatePath("/sell");
  return { ok: true, message: "ลบฉบับร่างแล้ว" };
}
