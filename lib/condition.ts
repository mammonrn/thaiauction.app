import type { ItemCondition } from "@/generated/prisma/enums";

/**
 * New or second-hand, in Thai.
 *
 * A buyer's first question about a used-goods auction, and the one thing a
 * photograph cannot settle. Kept here so the form, the card and the item page
 * all say it the same way.
 */
export const CONDITION_LABEL: Record<ItemCondition, string> = {
  brand_new: "ของใหม่",
  used: "มือสอง",
};

/** Listings that predate the field have no answer, and say so. */
export function conditionLabel(condition: ItemCondition | null): string {
  return condition ? CONDITION_LABEL[condition] : "ไม่ระบุ";
}

export function isItemCondition(value: string): value is ItemCondition {
  return value === "brand_new" || value === "used";
}
